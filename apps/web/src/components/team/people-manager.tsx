"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MoreHorizontal, Search } from "lucide-react";
import { apiRequest } from "@/lib/api-client";
import {
  peopleStateSchema,
  type AdminPerson,
  type PeopleState,
} from "@/lib/admin-contract";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  PauseButton,
  PauseClose,
  PauseDialog,
  PauseModal,
} from "@/components/pause/pause-dialog";
import { YuzuToast, type YuzuToastNotice } from "@/components/ui/yuzu-toast";

type Tab = "ACTIVE" | "DEACTIVATED" | "ALL";
const roleLabel: Record<string, string> = {
  OWNER: "Owner",
  ADMIN: "Admin",
  MEMBER: "Member",
};
const initials = (name: string) =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
const firstName = (name: string) => name.split(" ")[0] ?? name;

/** "Now", "2h ago", "Yesterday", or a short date. */
export function ago(iso: string | null, now = Date.now()) {
  if (!iso) return "Never";
  const minutes = Math.floor((now - new Date(iso).getTime()) / 60_000);
  if (minutes < 5) return "Now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)}h ago`;
  if (minutes < 48 * 60) return "Yesterday";
  if (minutes < 7 * 24 * 60) return `${Math.floor(minutes / 1440)} days ago`;
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

/** Everyone in the installation: roles, deactivation, ownership. */
export function PeopleManager({ currentUserId }: { currentUserId: string }) {
  const client = useQueryClient();
  const key = ["principal", currentUserId, "admin", "people"];
  const [tab, setTab] = useState<Tab>("ACTIVE");
  const [search, setSearch] = useState("");
  const [deactivating, setDeactivating] = useState<AdminPerson | null>(null);
  const [transferTo, setTransferTo] = useState<AdminPerson | null>(null);
  const [password, setPassword] = useState("");
  const [notice, setNotice] = useState<YuzuToastNotice | null>(null);
  const people = useQuery({
    queryKey: key,
    queryFn: async ({ signal }) =>
      peopleStateSchema.parse(
        (await apiRequest("/api/v1/admin/people", { signal })).data,
      ),
  });
  const action = useMutation({
    mutationFn: async (input: {
      action: "role" | "deactivate" | "reactivate" | "transfer";
      body: Record<string, string>;
      done: string;
    }) =>
      apiRequest(`/api/v1/admin/${input.action}`, {
        method: "POST",
        json: input.body,
      }),
    onSuccess: (_, input) => {
      setDeactivating(null);
      setTransferTo(null);
      setPassword("");
      setNotice({
        id: crypto.randomUUID(),
        kind: "success",
        message: input.done,
      });
      // Ownership moves navigation too: reload server-rendered parts.
      if (input.action === "transfer") window.location.reload();
    },
    onError: (error) =>
      setNotice({
        id: crypto.randomUUID(),
        kind: "error",
        title: "Couldn't update access",
        message: error.message,
      }),
    onSettled: () => client.invalidateQueries({ queryKey: key }),
  });
  if (people.isPending) return <p role="status">Loading people…</p>;
  if (people.error) return <p role="alert">{people.error.message}</p>;
  const state: PeopleState = people.data;
  const active = state.people.filter((person) => !person.deactivatedAt);
  const inactive = state.people.filter((person) => person.deactivatedAt);
  const query = search.trim().toLocaleLowerCase();
  const shown = (
    tab === "ACTIVE" ? active : tab === "DEACTIVATED" ? inactive : state.people
  ).filter(
    (person) =>
      !query ||
      person.name.toLocaleLowerCase().includes(query) ||
      person.email.toLocaleLowerCase().includes(query),
  );
  /** Owners manage everyone but themselves; admins manage members. */
  const canManage = (person: AdminPerson) =>
    person.id !== currentUserId &&
    person.role !== "OWNER" &&
    (person.role === "MEMBER" || state.isOwner);

  return (
    <section className="people-admin" aria-labelledby="people-heading">
      <YuzuToast notice={notice} />
      <div className="people-admin-bar">
        <h2 id="people-heading">People</h2>
        <label className="people-admin-search">
          <Search size={15} aria-hidden="true" />
          <input
            type="search"
            aria-label="Search people"
            placeholder="Search people"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
      </div>
      <div className="people-admin-tabs" role="group" aria-label="Show people">
        {(
          [
            ["ACTIVE", `Active ${active.length}`],
            ["DEACTIVATED", `Deactivated ${inactive.length}`],
            ["ALL", "All"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-pressed={tab === value}
            onClick={() => setTab(value)}
          >
            {label}
          </button>
        ))}
      </div>
      {state.invitationsWaiting > 0 && (
        <p className="people-admin-invites">
          <b>
            {state.invitationsWaiting}{" "}
            {state.invitationsWaiting === 1 ? "invitation" : "invitations"}{" "}
            waiting
          </b>
          <a href="#invitations">Manage</a>
        </p>
      )}
      <ul className="people-admin-rows">
        {shown.map((person) => (
          <li key={person.id} data-deactivated={Boolean(person.deactivatedAt)}>
            <span className="people-admin-avatar" aria-hidden="true">
              {initials(person.name)}
            </span>
            <div className="min-w-0">
              <b>
                {person.name}
                {person.id === currentUserId && (
                  <span className="people-admin-tag">You</span>
                )}
                {person.deactivatedAt && (
                  <span className="people-admin-tag">Deactivated</span>
                )}
              </b>
              <small>
                {person.email}
                {person.deactivatedAt
                  ? ` · deactivated${person.deactivatedBy ? ` by ${person.deactivatedBy}` : ""}, ${ago(person.deactivatedAt)}`
                  : person.workspaces.length
                    ? ` · ${person.workspaces.length > 2 ? `${person.workspaces.length} workspaces` : person.workspaces.join(", ")}`
                    : ""}
              </small>
            </div>
            <span className="people-admin-role" data-role={person.role}>
              {roleLabel[person.role] ?? person.role}
            </span>
            <span className="people-admin-seen">
              {person.deactivatedAt ? "" : ago(person.lastActiveAt)}
            </span>
            {canManage(person) ? (
              <DropdownMenu>
                <DropdownMenuTrigger
                  className="people-admin-more"
                  aria-label={`Manage ${person.name}`}
                >
                  <MoreHorizontal size={16} />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="people-admin-menu">
                  {state.isOwner && !person.deactivatedAt && (
                    <DropdownMenuItem
                      onSelect={() =>
                        action.mutate({
                          action: "role",
                          body: {
                            userId: person.id,
                            role: person.role === "ADMIN" ? "MEMBER" : "ADMIN",
                          },
                          done:
                            person.role === "ADMIN"
                              ? `${person.name} is now a member.`
                              : `${person.name} is now an admin.`,
                        })
                      }
                    >
                      <span>
                        {person.role === "ADMIN" ? "Make member" : "Make admin"}
                        <small>
                          {person.role === "ADMIN"
                            ? "Keeps their boards; no team or settings access"
                            : "Can manage people, workspaces and settings"}
                        </small>
                      </span>
                    </DropdownMenuItem>
                  )}
                  {state.isOwner &&
                    person.role === "ADMIN" &&
                    !person.deactivatedAt && (
                      <DropdownMenuItem onSelect={() => setTransferTo(person)}>
                        <span>
                          Transfer ownership…
                          <small>
                            They become the owner; you stay an admin
                          </small>
                        </span>
                      </DropdownMenuItem>
                    )}
                  {state.isOwner && !person.deactivatedAt && (
                    <DropdownMenuSeparator />
                  )}
                  {person.deactivatedAt ? (
                    <DropdownMenuItem
                      onSelect={() =>
                        action.mutate({
                          action: "reactivate",
                          body: { userId: person.id },
                          done: `${person.name} can sign in again.`,
                        })
                      }
                    >
                      <span>
                        Reactivate
                        <small>Lets them sign in again</small>
                      </span>
                    </DropdownMenuItem>
                  ) : (
                    <DropdownMenuItem
                      className="people-admin-warn"
                      onSelect={() => setDeactivating(person)}
                    >
                      <span>
                        Deactivate…
                        <small>Signs them out and blocks sign-in</small>
                      </span>
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <span />
            )}
          </li>
        ))}
        {!shown.length && (
          <li className="people-admin-empty">
            {query ? "No one matches that search." : "No one here yet."}
          </li>
        )}
      </ul>
      {state.isOwner ? (
        <p className="people-admin-foot">
          Only you, as the owner, can make admins or transfer ownership. Open an
          admin&apos;s menu to transfer it.
        </p>
      ) : (
        <p className="people-admin-foot">
          Only the owner can make admins or change an admin&apos;s access.
        </p>
      )}

      <PauseDialog
        open={Boolean(deactivating)}
        onOpenChange={(open) => !open && setDeactivating(null)}
        intent="danger"
        title={`Deactivate ${deactivating?.name ?? ""}?`}
        description={`${firstName(deactivating?.name ?? "")} can be reactivated any time.`}
        actions={
          <>
            <PauseClose asChild>
              <PauseButton>Cancel</PauseButton>
            </PauseClose>
            <PauseButton
              tone="primary"
              data-autofocus
              disabled={action.isPending}
              onClick={() =>
                deactivating &&
                action.mutate({
                  action: "deactivate",
                  body: { userId: deactivating.id },
                  done: `${deactivating.name} is deactivated.`,
                })
              }
            >
              {action.isPending
                ? "Deactivating…"
                : `Deactivate ${firstName(deactivating?.name ?? "")}`}
            </PauseButton>
          </>
        }
      >
        <ul className="people-admin-effects">
          <li>
            <b>Signed out everywhere</b> right away; they can&apos;t sign in or
            reset their password.
          </li>
          <li>
            <b>Their work stays.</b> Their name remains on tasks, comments and
            history; pickers stop offering them.
          </li>
          {Boolean(deactivating?.rules) && (
            <li>
              <b>
                {deactivating!.rules}{" "}
                {deactivating!.rules === 1 ? "rule" : "rules"} they made pause
              </b>{" "}
              until a board manager takes them over.
            </li>
          )}
          <li>
            <b>No more emails</b>; queued ones are cancelled.
          </li>
        </ul>
      </PauseDialog>

      <PauseModal
        open={Boolean(transferTo)}
        onOpenChange={(open) => {
          if (!open) {
            setTransferTo(null);
            setPassword("");
          }
        }}
        title={`Make ${transferTo?.name ?? ""} the owner?`}
        description="There's one owner. You'll stay an admin, and only the new owner can make admins or transfer ownership again."
        as="form"
        actions={
          <>
            <PauseClose asChild>
              <PauseButton>Cancel</PauseButton>
            </PauseClose>
            <PauseButton
              tone="primary"
              type="submit"
              disabled={action.isPending || !password}
            >
              {action.isPending ? "Transferring…" : "Transfer ownership"}
            </PauseButton>
          </>
        }
        onSubmit={(event) => {
          event.preventDefault();
          if (transferTo)
            action.mutate({
              action: "transfer",
              body: { userId: transferTo.id, password },
              done: `${transferTo.name} is now the owner.`,
            });
        }}
      >
        <label className="task-field-label">
          Your password
          <input
            type="password"
            className="task-select"
            aria-label="Your password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
      </PauseModal>
    </section>
  );
}
