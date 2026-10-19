"use client";
import { useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import {
  ArrowDownToLine,
  Boxes,
  KeyRound,
  ShieldAlert,
  UserCog,
} from "lucide-react";
import { apiRequest } from "@/lib/api-client";
import {
  auditKinds,
  auditPageSchema,
  auditRanges,
  auditSentence,
  type AuditEntry,
  type AuditKind,
} from "@/lib/admin-contract";

const kindOf = (action: string) =>
  (Object.keys(auditKinds) as AuditKind[]).find((kind) =>
    (auditKinds[kind].actions as readonly string[]).includes(action),
  );
const icons: Record<AuditKind, typeof UserCog> = {
  people: UserCog,
  access: KeyRound,
  security: ShieldAlert,
  workspaces: Boxes,
  data: ArrowDownToLine,
  api: KeyRound,
};
/** Details already said in the sentence aren't repeated underneath. */
const inSentence = new Set(["ROLE_CHANGED", "WORKSPACE_RENAMED"]);

function dayLabel(iso: string, timezone: string) {
  const day = (date: Date) =>
    date.toLocaleDateString("en-CA", { timeZone: timezone });
  const at = new Date(iso);
  if (day(at) === day(new Date())) return "Today";
  if (day(at) === day(new Date(Date.now() - 86_400_000))) return "Yesterday";
  return at.toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
    timeZone: timezone,
  });
}

/** The installation's audit log, newest first, 50 at a time. */
export function AuditLog({
  currentUserId,
  timezone,
}: {
  currentUserId: string;
  timezone: string;
}) {
  const [actorId, setActorId] = useState("");
  const [kind, setKind] = useState<AuditKind | "">("");
  const [range, setRange] = useState<keyof typeof auditRanges>("30");
  const log = useInfiniteQuery({
    queryKey: [
      "principal",
      currentUserId,
      "admin",
      "audit",
      { actorId, kind, range },
    ],
    initialPageParam: "",
    queryFn: async ({ pageParam, signal }) => {
      const params = new URLSearchParams({ range });
      if (actorId) params.set("actorId", actorId);
      if (kind) params.set("kind", kind);
      if (pageParam) params.set("before", pageParam);
      return auditPageSchema.parse(
        (await apiRequest(`/api/v1/admin/audit?${params}`, { signal })).data,
      );
    },
    getNextPageParam: (page) => page.next ?? undefined,
  });
  const events = log.data?.pages.flatMap((page) => page.events) ?? [];
  const people = log.data?.pages[0]?.people ?? [];
  const days: { label: string; events: AuditEntry[] }[] = [];
  for (const event of events) {
    const label = dayLabel(event.createdAt, timezone);
    if (days.at(-1)?.label !== label) days.push({ label, events: [] });
    days.at(-1)!.events.push(event);
  }
  return (
    <div>
      <div className="audit-filters">
        <select
          aria-label="Filter by person"
          className="task-select"
          value={actorId}
          onChange={(event) => setActorId(event.target.value)}
        >
          <option value="">Anyone</option>
          {people.map((person) => (
            <option key={person.id} value={person.id}>
              {person.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Filter by event"
          className="task-select"
          value={kind}
          onChange={(event) => setKind(event.target.value as AuditKind | "")}
        >
          <option value="">All events</option>
          {(Object.keys(auditKinds) as AuditKind[]).map((key) => (
            <option key={key} value={key}>
              {auditKinds[key].label}
            </option>
          ))}
        </select>
        <select
          aria-label="Time range"
          className="task-select"
          value={range}
          onChange={(event) =>
            setRange(event.target.value as keyof typeof auditRanges)
          }
        >
          {Object.entries(auditRanges).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>
      {log.isPending ? (
        <p role="status" className="audit-empty">
          Loading the audit log…
        </p>
      ) : log.error ? (
        <p role="alert" className="audit-empty">
          {log.error.message}
        </p>
      ) : !events.length ? (
        <p className="audit-empty">
          Nothing recorded for these filters. Try a longer time range.
        </p>
      ) : (
        days.map((day) => (
          <section key={day.label} aria-label={day.label}>
            <h2 className="audit-day">{day.label}</h2>
            <ul className="audit-events">
              {day.events.map((event) => {
                const group = kindOf(event.action);
                const Icon = group ? icons[group] : UserCog;
                return (
                  <li key={event.id}>
                    <span
                      className="audit-icon"
                      data-kind={group ?? "people"}
                      data-action={event.action}
                      aria-hidden="true"
                    >
                      <Icon size={14} />
                    </span>
                    <div className="min-w-0">
                      <p>
                        {event.actor && <b>{event.actor} </b>}
                        {auditSentence(event)}
                      </p>
                      {((event.details && !inSentence.has(event.action)) ||
                        event.workspace) && (
                        <small>
                          {[
                            !inSentence.has(event.action) && event.details,
                            event.workspace,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </small>
                      )}
                    </div>
                    <time dateTime={event.createdAt}>
                      {new Date(event.createdAt).toLocaleTimeString(undefined, {
                        hour: "numeric",
                        minute: "2-digit",
                        timeZone: timezone,
                      })}
                    </time>
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}
      {log.hasNextPage && (
        <button
          type="button"
          className="audit-more"
          disabled={log.isFetchingNextPage}
          onClick={() => void log.fetchNextPage()}
        >
          {log.isFetchingNextPage ? "Loading…" : "Load more"}
        </button>
      )}
    </div>
  );
}
