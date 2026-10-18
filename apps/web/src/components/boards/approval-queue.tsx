"use client";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { CheckCheck, ArrowRight, Clock3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { YuzuToast, type YuzuToastNotice } from "@/components/ui/yuzu-toast";
import { apiRequest } from "@/lib/api-client";
import {
  approvalQueueSchema,
  type ApprovalQueue,
} from "@/lib/approval-contract";
import { useApprovalLiveSync } from "./use-board-live-sync";
import { formatDueDate } from "./board-presentation";
import { z } from "zod";
type Proposal = ApprovalQueue["proposals"][number];
const states = {
  PENDING: "Pending",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  WITHDRAWN: "Withdrawn",
  STALE: "Needs resubmission",
};
const operations = {
  CREATE: "Create task",
  UPDATE: "Change task",
  ARCHIVE: "Archive task",
};
const coreKeys: Record<string, string> = {
  statusId: "status",
  assigneeIds: "assignees",
  startDate: "start_date",
  dueDate: "due_date",
};
function displayValue(value: unknown, key: string, proposal: Proposal): string {
  if (key === "checklist" && Array.isArray(value))
    return value.length
      ? value.map((item) => `${item.done ? "✓" : "☐"} ${item.text}`).join("\n")
      : "No checklist items";
  if (value == null || value === "") return "None";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if ((key === "dueDate" || key === "startDate") && typeof value === "string")
    return formatDueDate(value, true);
  if (key === "groupId")
    return (
      proposal.groups.find((group) => group.id === value)?.name ??
      "Former group"
    );
  const field = proposal.fields.find(
    (field) =>
      key === `field:${field.id}` || field.key === (coreKeys[key] ?? key),
  );
  const item = (raw: unknown) =>
    key === "assigneeIds" || field?.type === "PEOPLE"
      ? (proposal.people.find((person) => person.id === raw)?.name ??
        "Former member")
      : (field?.options.find((option) => option.id === raw)?.label ??
        String(raw));
  if (Array.isArray(value))
    return value.length ? value.map(item).join(", ") : "None";
  if (key === "priority" && !field?.options.length)
    return String(value)
      .toLowerCase()
      .replace(/^./, (char) => char.toUpperCase());
  return item(value);
}
function changeRows(proposal: Proposal) {
  if (proposal.operation === "ARCHIVE")
    return [
      {
        key: "archive",
        label: "Task visibility",
        before: "Active",
        after: "Archived",
      },
    ];
  const rows = Object.entries(proposal.changes)
    .filter(([key]) => !["boardId", "createKey", "fieldValues"].includes(key))
    .map(([key, value]) => ({
      key,
      label:
        key === "checklist"
          ? "Checklist"
          : key === "groupId"
            ? "Group"
            : (proposal.fields.find(
                (field) => field.key === (coreKeys[key] ?? key),
              )?.name ?? key),
      before: displayValue(proposal.baseline[key], key, proposal),
      after: displayValue(value, key, proposal),
    }));
  const beforeFields =
    (proposal.baseline.fieldValues as Record<string, unknown>) ?? {};
  for (const [id, value] of Object.entries(
    (proposal.changes.fieldValues as Record<string, unknown>) ?? {},
  ))
    rows.push({
      key: `field:${id}`,
      label:
        proposal.fields.find((field) => field.id === id)?.name ??
        "Removed field",
      before: displayValue(beforeFields[id], `field:${id}`, proposal),
      after: displayValue(value, `field:${id}`, proposal),
    });
  return rows;
}
export function ApprovalQueueView({
  initialData,
  timezone,
  initialRequestId,
}: {
  initialData: ApprovalQueue;
  timezone: string;
  initialRequestId?: string;
}) {
  const [filter, setFilter] = useState(initialRequestId ? "ALL" : "PENDING");
  const [requestId, setRequestId] = useState(initialRequestId);
  const [cursors, setCursors] = useState<(string | null)[]>([null]);
  const cursor = cursors.at(-1);
  const [selectedId, setSelectedId] = useState<string | null>(
    initialRequestId ?? null,
  );
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [notice, setNotice] = useState<YuzuToastNotice | null>(null);
  const queryClient = useQueryClient();
  const prefix = ["principal", initialData.currentUserId, "approvals"];
  const live = useApprovalLiveSync(initialData.currentUserId);
  const query = useQuery({
    queryKey: [...prefix, filter, cursor, requestId],
    initialData:
      (initialRequestId
        ? filter === "ALL" && requestId === initialRequestId
        : filter === "PENDING") && !cursor
        ? initialData
        : undefined,
    staleTime: 0,
    refetchInterval: live.syncInterval,
    refetchOnWindowFocus: "always",
    refetchOnReconnect: "always",
    queryFn: async ({ signal }) => {
      const response = await apiRequest(
        `/api/v1/approvals/queue?status=${filter}${cursor ? `&cursor=${cursor}` : ""}${requestId ? `&request=${requestId}` : ""}`,
        { signal, cache: "no-store" },
      );
      const parsed = approvalQueueSchema.safeParse(response.data);
      if (!parsed.success)
        throw new Error(
          "Approval requests could not be read. Try opening the page again.",
        );
      return parsed.data;
    },
  });
  const mutation = useMutation({
    mutationKey: prefix,
    mutationFn: async (input: {
      proposalId: string;
      action: "approve" | "reject" | "withdraw";
      reason?: string;
    }) =>
      z
        .object({
          status: z.enum(["APPROVED", "REJECTED", "WITHDRAWN", "STALE"]),
          reason: z.string().nullable(),
        })
        .parse(
          (
            await apiRequest("/api/v1/approvals/decide", {
              method: "POST",
              json: input,
            })
          ).data,
        ),
    onSuccess: async (result) => {
      setSelectedId(null);
      setRequestId(undefined);
      setRejecting(false);
      setReason("");
      setNotice({
        id: crypto.randomUUID(),
        kind:
          result.status === "STALE"
            ? "warning"
            : result.status === "APPROVED"
              ? "success"
              : "info",
        title: states[result.status],
        message:
          result.reason ??
          (result.status === "APPROVED"
            ? "The approved change is now on the board."
            : "The current task values were kept."),
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: prefix }),
        queryClient.invalidateQueries({
          queryKey: ["principal", initialData.currentUserId, "boards"],
        }),
      ]);
    },
    onError: async (error) => {
      setNotice({
        id: crypto.randomUUID(),
        kind: "error",
        message: error.message,
      });
      await query.refetch();
    },
  });
  const selected = query.data?.proposals.find(
    (proposal) => proposal.id === selectedId,
  );
  const timestamp = (value: string) =>
    new Intl.DateTimeFormat("en", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: timezone,
    }).format(new Date(value));
  return (
    <section
      className="space-y-6"
      data-slot="approval-queue"
      data-connection={live.status}
    >
      <YuzuToast notice={notice} />
      <div className="project-heading">
        <div className="project-symbol">
          <CheckCheck size={27} />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl sm:text-3xl">Approvals</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Review the change, keep the context, and decide together.
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          Show
          <select
            aria-label="Filter approval requests"
            className="task-select w-auto"
            value={filter}
            onChange={(event) => {
              setFilter(event.target.value);
              setRequestId(undefined);
              setCursors([null]);
              setSelectedId(null);
            }}
          >
            <option value="PENDING">Pending requests</option>
            <option value="ALL">All requests</option>
            {Object.entries(states)
              .filter(([key]) => key !== "PENDING")
              .map(([value, label]) => (
                <option value={value} key={value}>
                  {label}
                </option>
              ))}
          </select>
        </label>
        <p className="text-xs text-muted-foreground">
          One other approver. No self-approval.
        </p>
      </div>
      {query.error && (
        <p role="alert" className="text-sm text-destructive">
          {query.error.message}
        </p>
      )}
      {query.isLoading && (
        <p role="status" className="text-sm text-muted-foreground">
          Loading requests…
        </p>
      )}
      {!query.isLoading && !query.error && !query.data?.proposals.length && (
        <div className="flex min-h-60 flex-col items-center justify-center gap-3 rounded-lg border border-border bg-card/50 p-6 text-center">
          <CheckCheck className="text-muted-foreground" size={32} />
          <h2 className="text-base font-semibold">
            {filter === "PENDING"
              ? "No requests waiting for review"
              : "No requests in this view"}
          </h2>
          <p className="max-w-md text-sm leading-6 text-muted-foreground">
            Requests appear here when an authorized task change needs approval.
            You can review your submissions and the boards you manage.
          </p>
          <Button asChild variant="outline" size="sm">
            <Link href="/boards">Go to boards</Link>
          </Button>
        </div>
      )}
      {Boolean(query.data?.proposals.length) && (
        <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card/40">
          {query.data?.proposals.map((proposal) => (
            <li key={proposal.id} data-proposal-id={proposal.id}>
              <button
                type="button"
                className="flex w-full flex-wrap items-center gap-4 p-4 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                aria-label={`Review ${proposal.name}`}
                onClick={() => {
                  setSelectedId(proposal.id);
                  setRejecting(false);
                  setReason("");
                  mutation.reset();
                }}
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border text-primary">
                  <Clock3 size={17} />
                </span>
                <span className="min-w-0 flex-1">
                  <strong className="block break-words text-sm font-semibold">
                    {proposal.name}
                  </strong>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {operations[proposal.operation]} · {proposal.boardName}
                  </span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    Requested by {proposal.authorName} ·{" "}
                    {timestamp(proposal.createdAt)}
                  </span>
                </span>
                <span className="rounded-full border border-border bg-muted/40 px-2.5 py-1 text-xs">
                  {states[proposal.status]}
                </span>
                <ArrowRight
                  aria-hidden="true"
                  size={15}
                  className="text-muted-foreground"
                />
              </button>
            </li>
          ))}
        </ul>
      )}
      {(cursors.length > 1 || query.data?.nextCursor) && (
        <div className="flex items-center justify-between">
          <Button
            variant="outline"
            size="sm"
            disabled={cursors.length === 1 || query.isFetching}
            onClick={() => setCursors(cursors.slice(0, -1))}
          >
            Previous page
          </Button>
          <span className="text-xs text-muted-foreground">
            Page {cursors.length}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={!query.data?.nextCursor || query.isFetching}
            onClick={() => setCursors([...cursors, query.data!.nextCursor])}
          >
            Next page
          </Button>
        </div>
      )}
      <Sheet
        open={Boolean(selected)}
        onOpenChange={(open) => {
          if (!open && !mutation.isPending) setSelectedId(null);
        }}
      >
        <SheetContent className="board-details-panel task-sheet-panel">
          {selected && (
            <>
              <header className="task-sheet-header">
                <span className="task-meta-chip">
                  {states[selected.status]}
                </span>
                <SheetTitle className="task-sheet-title mt-3">
                  {selected.name}
                </SheetTitle>
                <SheetDescription className="mt-2 text-sm">
                  {operations[selected.operation]} on{" "}
                  <Link
                    className="text-primary underline"
                    href={`/boards/${selected.boardId}`}
                  >
                    {selected.boardName}
                  </Link>
                </SheetDescription>
                <p className="mt-3 text-xs text-muted-foreground">
                  Requested by {selected.authorName} ·{" "}
                  {timestamp(selected.createdAt)}
                </p>
                <p className="mt-2 text-xs text-muted-foreground">
                  {selected.status === "PENDING"
                    ? `Reviewer: ${selected.reviewerName ?? "No eligible reviewer — ask a board manager"}`
                    : `${states[selected.status]}${selected.decidedByName ? ` by ${selected.decidedByName}` : ""}${selected.decidedAt ? ` · ${timestamp(selected.decidedAt)}` : ""}`}
                </p>
              </header>
              <div className="task-sheet-body">
                <div className="task-sheet-details space-y-5">
                  <p className="text-xs leading-5 text-muted-foreground">
                    {selected.status === "APPROVED"
                      ? "This request was applied. The task may have changed since the decision."
                      : selected.status === "PENDING"
                        ? selected.operation === "CREATE"
                          ? "This task is not on the active board yet."
                          : "Current task values stay unchanged until this request is approved."
                        : "This request did not apply a change to the active board."}{" "}
                    Permissions, policy and affected fields are checked again
                    before applying a change.
                  </p>
                  <div className="space-y-4" aria-label="Proposed changes">
                    {changeRows(selected).map((row) => (
                      <section
                        className="space-y-2 border-b border-border pb-4"
                        key={row.key}
                      >
                        <h3 className="break-words text-xs font-semibold">
                          {row.label}
                        </h3>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <p className="mb-1 text-xs text-muted-foreground">
                              At submission
                            </p>
                            <p className="whitespace-pre-wrap break-words rounded-md border border-border bg-muted/30 p-2 text-sm">
                              {selected.operation === "CREATE"
                                ? "—"
                                : row.before}
                            </p>
                          </div>
                          <div>
                            <p className="mb-1 text-xs text-primary">
                              Proposed
                            </p>
                            <p className="whitespace-pre-wrap break-words rounded-md border border-border bg-primary/5 p-2 text-sm">
                              {row.after}
                            </p>
                          </div>
                        </div>
                      </section>
                    ))}
                  </div>
                  {selected.reason && (
                    <section className="rounded-md border border-border bg-muted/40 p-3">
                      <h3 className="text-xs font-semibold">
                        {selected.status === "STALE"
                          ? "Why resubmission is needed"
                          : "Decision reason"}
                      </h3>
                      <p className="mt-2 whitespace-pre-wrap break-words text-sm">
                        {selected.reason}
                      </p>
                    </section>
                  )}
                  {selected.canDecide && rejecting && (
                    <form
                      id="reject-request"
                      className="space-y-3"
                      onSubmit={(event) => {
                        event.preventDefault();
                        mutation.mutate({
                          proposalId: selected.id,
                          action: "reject",
                          reason,
                        });
                      }}
                    >
                      <label className="task-field-label">
                        Rejection reason
                        <textarea
                          aria-label="Rejection reason"
                          className="task-textarea"
                          rows={3}
                          required
                          maxLength={500}
                          value={reason}
                          onChange={(event) => setReason(event.target.value)}
                          disabled={mutation.isPending}
                        />
                      </label>
                    </form>
                  )}
                  {selected.status === "PENDING" &&
                    !selected.canDecide &&
                    !selected.canWithdraw && (
                      <p className="text-xs text-muted-foreground">
                        You can inspect this request. Only its designated
                        reviewer can decide it.
                      </p>
                    )}
                  {selected.canWithdraw && (
                    <p className="text-xs text-muted-foreground">
                      You cannot decide your own request. You can withdraw it
                      while it is pending.
                    </p>
                  )}
                  {mutation.error && (
                    <p role="alert" className="text-sm text-destructive">
                      {mutation.error.message}
                    </p>
                  )}
                </div>
              </div>
              <footer className="task-sheet-footer">
                {selected.canDecide && (
                  <>
                    {rejecting ? (
                      <>
                        <Button
                          type="submit"
                          form="reject-request"
                          disabled={mutation.isPending || !reason.trim()}
                        >
                          Reject request
                        </Button>
                        <Button
                          variant="outline"
                          disabled={mutation.isPending}
                          onClick={() => setRejecting(false)}
                        >
                          Cancel
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button
                          disabled={mutation.isPending}
                          onClick={() =>
                            mutation.mutate({
                              proposalId: selected.id,
                              action: "approve",
                            })
                          }
                        >
                          {mutation.isPending ? "Applying…" : "Approve request"}
                        </Button>
                        <Button
                          variant="outline"
                          disabled={mutation.isPending}
                          onClick={() => setRejecting(true)}
                        >
                          Reject
                        </Button>
                      </>
                    )}
                  </>
                )}
                {selected.canWithdraw && (
                  <Button
                    variant="outline"
                    disabled={mutation.isPending}
                    onClick={() =>
                      mutation.mutate({
                        proposalId: selected.id,
                        action: "withdraw",
                      })
                    }
                  >
                    Withdraw request
                  </Button>
                )}
                {!selected.canDecide && !selected.canWithdraw && (
                  <Button variant="outline" onClick={() => setSelectedId(null)}>
                    Close review
                  </Button>
                )}
              </footer>
            </>
          )}
        </SheetContent>
      </Sheet>
    </section>
  );
}
