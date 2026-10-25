"use client";
import type { BuiltinKey } from "@/lib/record-types";
import { useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowUp,
  History,
  Pencil,
  Plus,
  Trash2,
  X,
  Zap,
} from "lucide-react";
import { z } from "zod";
import { apiRequest } from "@/lib/api-client";
import { needsApproval } from "@/lib/approval-rules";
import {
  automationRuleSchema,
  automationRunSchema,
  type AutomationAction,
  type AutomationCondition,
  type AutomationRule,
  type AutomationRun,
  type AutomationTrigger,
} from "@/lib/automation-contract";
import {
  describeRule,
  type Part,
  type RuleLabels,
} from "@/lib/automation-describe";
import { coreKeys, recordOf, type BoardState } from "@/lib/board-contract";
import { nextOccurrence, type Schedule } from "@/lib/automation-schedule";
import { messageFields } from "@/lib/automation-message";
import { priorityOptions } from "./board-presentation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { PauseSheetDecor } from "@/components/pause/pause-sheet";
import { PauseAlert } from "@/components/pause/pause-alert";
import {
  PauseButton,
  PauseClose,
  PauseDialog,
  PauseModal,
} from "@/components/pause/pause-dialog";

type Draft = {
  recordScope?: "ROOTS" | "SUBITEMS" | "BOTH";
  id?: string;
  revision?: number;
  name: string;
  trigger: AutomationTrigger;
  match?: "all" | "any";
  conditions: AutomationCondition[];
  actions: AutomationAction[];
};

/** What the rules list tells the builder beyond the rules themselves. */
type Meta = {
  timezone: string;
  canWebhook: boolean;
  boards: { id: string; name: string }[];
};
const listSchema = z.object({
  rules: z.array(automationRuleSchema),
  timezone: z.string(),
  canWebhook: z.boolean(),
  boards: z.array(z.object({ id: z.string(), name: z.string() })),
});

/** Everything the builder offers, read from the board. */
function boardChoices(state: BoardState) {
  const statuses =
    state.fields.find((field) => field.key === "status")?.options ?? [];
  const custom = state.fields.filter((field) => !coreKeys.includes(field.key));
  return {
    statuses,
    priorities: priorityOptions(state),
    groups: state.groups,
    people: state.people.filter((person) => !person.deactivated),
    selectFields: custom.filter((field) =>
      ["SINGLE_SELECT", "TAGS"].includes(field.type),
    ),
    checkFields: custom.filter((field) => field.type === "CHECKBOX"),
    dateFields: custom.filter((field) => field.type === "DATE"),
  };
}
type Choices = ReturnType<typeof boardChoices>;

export function ruleLabels(state: BoardState): RuleLabels {
  const choices = boardChoices(state);
  return {
    status: (id) =>
      id === null
        ? "No status"
        : (choices.statuses.find((option) => option.id === id)?.label ??
          "a removed status"),
    priority: (id) =>
      choices.priorities.find((option) => option.id === id)?.label ?? id,
    group: (id) =>
      id === null
        ? "No group"
        : (choices.groups.find((group) => group.id === id)?.name ??
          "a removed group"),
    person: (id) =>
      choices.people.find((person) => person.id === id)?.name ??
      "a former member",
    field: (id) =>
      state.fields.find((field) => field.id === id)?.name ?? "a removed field",
    option: (fieldId, id) =>
      state.fields
        .find((field) => field.id === fieldId)
        ?.options.find((option) => option.id === id)?.label ??
      "a removed option",
  };
}

function Sentence({ parts }: { parts: Part[] }) {
  return (
    <p className="automation-sentence">
      {parts.map((part, index) =>
        part.strong ? (
          <b key={index}>{part.text}</b>
        ) : (
          <span key={index}>{part.text}</span>
        ),
      )}
    </p>
  );
}

function ago(value: string) {
  const minutes = Math.round((Date.now() - new Date(value).getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 1440) return `${Math.round(minutes / 60)}h ago`;
  if (minutes < 2880) return "yesterday";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}

/** The board's automations: a toolbar button, the rules sheet and its modals. */
export function BoardAutomations({ state }: { state: BoardState }) {
  const client = useQueryClient();
  const key = [
    "principal",
    state.currentUserId,
    "automations",
    state.boardId,
  ] as const;
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [history, setHistory] = useState<AutomationRule | null>(null);
  const [removing, setRemoving] = useState<AutomationRule | null>(null);
  const labels = ruleLabels(state);
  const choices = boardChoices(state);
  const rules = useQuery({
    queryKey: key,
    enabled: open && state.canManage,
    refetchInterval: open ? 15_000 : false,
    queryFn: async ({ signal }) =>
      listSchema.parse(
        (
          await apiRequest(
            `/api/v1/automations/list?boardId=${state.boardId}`,
            { signal, cache: "no-store" },
          )
        ).data,
      ),
  });
  const meta: Meta = rules.data ?? {
    timezone: "UTC",
    canWebhook: false,
    boards: [],
  };
  const [secret, setSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  labels.board = (id) =>
    meta.boards.find((board) => board.id === id)?.name ?? "another board";
  const mutation = useMutation({
    mutationFn: async ({
      action,
      body,
    }: {
      action: "save" | "toggle" | "remove";
      body: unknown;
    }) =>
      apiRequest(`/api/v1/automations/${action}`, {
        method: "POST",
        json: body,
      }),
    onSuccess: (result, { action }) => {
      if (action === "save") setDraft(null);
      // A new webhook secret is shown once, right after saving.
      const revealed = (result.data as { webhookSecret?: string } | undefined)
        ?.webhookSecret;
      if (revealed) {
        setCopied(false);
        setSecret(revealed);
      }
      if (action === "remove") setRemoving(null);
    },
    onSettled: () => client.invalidateQueries({ queryKey: key }),
  });
  if (!state.canManage) return null;
  const start = (preset?: Omit<Draft, "id" | "revision">) => {
    mutation.reset();
    setDraft(
      preset ?? {
        name: "",
        trigger: {
          kind: "status.changed",
          from: null,
          to: choices.statuses.at(-1)?.id ?? "done",
        },
        conditions: [],
        actions: [{ kind: "notify", to: "assignees" }],
      },
    );
  };
  const list = rules.data?.rules ?? [];
  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          mutation.reset();
          setOpen(true);
        }}
      >
        <Zap size={15} />
        <span>Automations</span>
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="pause-sheet automation-sheet">
          <PauseSheetDecor />
          <div className="pause-sheet-body grid content-start gap-5">
            <div className="automation-head">
              <div>
                <SheetTitle>Automations</SheetTitle>
                <SheetDescription className="mt-1">
                  Rules run in the background as the person who made them.
                </SheetDescription>
              </div>
              <Button size="sm" onClick={() => start()}>
                <Plus size={14} />
                New rule
              </Button>
            </div>
            {rules.error && (
              <PauseAlert intent="danger">{rules.error.message}</PauseAlert>
            )}
            {mutation.error && !draft && !removing && (
              <PauseAlert intent="danger">{mutation.error.message}</PauseAlert>
            )}
            {rules.isPending && (
              <p role="status" className="text-sm text-muted-foreground">
                Loading rules…
              </p>
            )}
            {!rules.isPending && !list.length && (
              <div className="automation-empty">
                <Zap size={22} aria-hidden="true" />
                <p>
                  No rules yet. Start from a template, or build your own with
                  New rule.
                </p>
              </div>
            )}
            <ul className="automation-rules">
              {list.map((rule) => (
                <li key={rule.id} className="automation-rule">
                  <div className="automation-rule-head">
                    <h3>{rule.name}</h3>
                    <Switch
                      checked={rule.enabled}
                      aria-label={`${rule.enabled ? "Turn off" : "Turn on"} ${rule.name}`}
                      disabled={mutation.isPending}
                      onCheckedChange={(enabled) =>
                        mutation.mutate({
                          action: "toggle",
                          body: {
                            id: rule.id,
                            revision: rule.revision,
                            enabled,
                          },
                        })
                      }
                    />
                  </div>
                  <Sentence parts={describeRule(rule, labels)} />
                  <div className="automation-stats">
                    <span>
                      {rule.lastRunAt
                        ? `Last run ${ago(rule.lastRunAt)}`
                        : "Not run yet"}
                    </span>
                    {rule.nextRunAt && (
                      <span>Next {when(rule.nextRunAt, meta.timezone)}</span>
                    )}
                    <span>
                      {rule.runCount} {rule.runCount === 1 ? "run" : "runs"}
                    </span>
                    <span data-alert={rule.failureCount > 0 || undefined}>
                      {rule.failureCount} failed
                    </span>
                    <span className="automation-stats-by">
                      by {rule.createdByName}
                    </span>
                  </div>
                  {rule.pausedReason && (
                    <PauseAlert
                      intent="warning"
                      className="mt-3"
                      action={
                        <button type="button" onClick={() => setHistory(rule)}>
                          View runs
                        </button>
                      }
                    >
                      {rule.pausedReason}
                    </PauseAlert>
                  )}
                  <div className="automation-rule-actions">
                    <button
                      type="button"
                      aria-label={`Edit ${rule.name}`}
                      onClick={() => {
                        mutation.reset();
                        setDraft({
                          id: rule.id,
                          revision: rule.revision,
                          recordScope: rule.recordScope ?? "ROOTS",
                          name: rule.name,
                          trigger: rule.trigger,
                          match: rule.match,
                          conditions: rule.conditions,
                          actions: rule.actions,
                        });
                      }}
                    >
                      <Pencil size={13} /> Edit
                    </button>
                    <button
                      type="button"
                      aria-label={`Runs for ${rule.name}`}
                      onClick={() => setHistory(rule)}
                    >
                      <History size={13} /> Runs
                    </button>
                    <button
                      type="button"
                      aria-label={`Remove ${rule.name}`}
                      onClick={() => {
                        mutation.reset();
                        setRemoving(rule);
                      }}
                    >
                      <Trash2 size={13} /> Remove
                    </button>
                  </div>
                </li>
              ))}
            </ul>
            <section className="automation-templates" aria-label="Templates">
              <p>Start from a template</p>
              <div>
                {templates(choices, state.currentUserId, meta).map(
                  (template) => (
                    <button
                      key={template.name}
                      type="button"
                      onClick={() => start(template)}
                    >
                      {template.name}
                    </button>
                  ),
                )}
              </div>
            </section>
          </div>
        </SheetContent>
      </Sheet>
      {draft && (
        <RuleBuilder
          draft={draft}
          state={state}
          meta={meta}
          labels={labels}
          saving={mutation.isPending}
          error={mutation.error?.message}
          onChange={setDraft}
          onClose={() => !mutation.isPending && setDraft(null)}
          onSave={() =>
            mutation.mutate({
              action: "save",
              body: { boardId: state.boardId, ...draft },
            })
          }
        />
      )}
      <PauseDialog
        open={!!removing}
        onOpenChange={(next) =>
          !next && !mutation.isPending && setRemoving(null)
        }
        intent="danger"
        destructive
        title={`Remove “${removing?.name ?? ""}”?`}
        description="The rule stops running and its history is deleted. Tasks keep the changes it already made."
        actions={
          <>
            <PauseClose asChild>
              <PauseButton>Keep rule</PauseButton>
            </PauseClose>
            <PauseButton
              tone="primary"
              disabled={mutation.isPending}
              onClick={() =>
                removing &&
                mutation.mutate({
                  action: "remove",
                  body: { id: removing.id, revision: removing.revision },
                })
              }
            >
              {mutation.isPending ? "Removing…" : "Remove rule"}
            </PauseButton>
          </>
        }
      >
        {mutation.error && removing && (
          <PauseAlert intent="danger">{mutation.error.message}</PauseAlert>
        )}
      </PauseDialog>
      <PauseDialog
        open={!!secret}
        onOpenChange={(next) => !next && setSecret(null)}
        intent="warning"
        title="Webhook signing secret"
        description="Shown once. Your receiving tool uses it to check the X-Yuzu-Signature header on each delivery."
        actions={
          <PauseClose asChild>
            <PauseButton tone="primary">I&apos;ve saved it</PauseButton>
          </PauseClose>
        }
      >
        <div className="automation-secret">
          <code aria-label="Webhook signing secret">{secret}</code>
          <PauseButton
            onClick={() => {
              if (!secret) return;
              void navigator.clipboard?.writeText(secret);
              setCopied(true);
            }}
          >
            {copied ? "Copied" : "Copy"}
          </PauseButton>
        </div>
      </PauseDialog>
      {history && (
        <RunHistory
          rule={history}
          state={state}
          onClose={() => setHistory(null)}
        />
      )}
    </>
  );
}

function templates(
  choices: Choices,
  userId: string,
  meta: Meta,
): Omit<Draft, "id" | "revision">[] {
  const done =
    choices.statuses.find((option) => option.id === "done")?.id ??
    choices.statuses.at(-1)?.id;
  const started =
    choices.statuses.find((option) => option.id === "in_progress")?.id ??
    choices.statuses[1]?.id;
  return [
    ...(done
      ? [
          {
            name: "Notify on completion",
            trigger: { kind: "status.changed", from: null, to: done } as const,
            conditions: [],
            actions: [{ kind: "notify", to: "creator" } as const],
          },
        ]
      : []),
    {
      name: "Escalate overdue",
      trigger: { kind: "due.overdue" },
      conditions: [],
      actions: [
        { kind: "set.priority", value: "URGENT" },
        { kind: "notify", to: "assignees" },
      ],
    },
    {
      name: "Auto-assign new tasks",
      trigger: { kind: "task.created" },
      conditions: [{ subject: "assignees", op: "empty" }],
      actions: [{ kind: "assign", userId }],
    },
    ...(started
      ? [
          {
            name: "Set due date on start",
            trigger: {
              kind: "status.changed",
              from: null,
              to: started,
            } as const,
            conditions: [{ subject: "due", op: "unset" } as const],
            actions: [{ kind: "set.date", field: "dueDate", days: 3 } as const],
          },
        ]
      : []),
    {
      name: "Weekly report",
      trigger: {
        kind: "schedule",
        schedule: { every: "week", days: [1], time: "09:00" },
      },
      conditions: [],
      actions: [
        {
          kind: "create.task",
          boardId: null,
          name: "Weekly report – week of {date}",
          assigneeIds: [userId],
          dueInDays: 4,
        },
      ],
    },
    ...(done && meta.boards[0]
      ? [
          {
            name: "Hand off to another board",
            trigger: { kind: "status.changed", from: null, to: done } as const,
            conditions: [],
            actions: [
              {
                kind: "create.task" as const,
                boardId: meta.boards[0].id,
                name: "Follow up: {task}",
                assigneeIds: [] as string[],
                dueInDays: null,
              },
            ],
          },
        ]
      : []),
  ];
}

/** "Mon, Oct 27 at 09:00" in the installation timezone. */
function when(iso: string, zone: string) {
  return new Intl.DateTimeFormat("en", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: zone,
  })
    .format(new Date(iso))
    .replace(/, (\d\d:\d\d)$/, " at $1");
}
const weekdays = [
  ["Monday", 1],
  ["Tuesday", 2],
  ["Wednesday", 3],
  ["Thursday", 4],
  ["Friday", 5],
  ["Saturday", 6],
  ["Sunday", 0],
] as const;

// ---------- Builder ----------

/** A sentence slot: a small dropdown that reads as part of the rule. */
function Pick({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
}) {
  return (
    <select
      aria-label={label}
      className="automation-pick"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      {children}
    </select>
  );
}

function triggerValue(trigger: AutomationTrigger) {
  return trigger.kind === "field.changed"
    ? `field:${trigger.field}`
    : trigger.kind;
}

function RuleBuilder({
  draft,
  state,
  meta,
  labels,
  saving,
  error,
  onChange,
  onClose,
  onSave,
}: {
  draft: Draft;
  state: BoardState;
  meta: Meta;
  labels: RuleLabels;
  saving: boolean;
  error?: string;
  onChange: (draft: Draft) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  const choices = boardChoices(state);
  // Only offer built-ins that are on for this board.
  const on = Object.fromEntries(
    Object.entries(recordOf(state).builtins).map(([key, value]) => [
      key,
      value.on,
    ]),
  ) as Record<BuiltinKey, boolean>;
  const set = (patch: Partial<Draft>) => onChange({ ...draft, ...patch });
  const scheduled = draft.trigger.kind === "schedule";
  /** Scheduled rules can't read a task: keep only task-free steps. */
  const fitSchedule = (actions: AutomationAction[]) => {
    const kept = actions.filter(
      (action) =>
        action.kind === "create.task" ||
        (action.kind === "webhook" && meta.canWebhook) ||
        ((action.kind === "notify" || action.kind === "email") &&
          action.to === "people"),
    );
    return kept.length ? kept : [newAction("create.task")];
  };
  const firstStatus = choices.statuses[0]?.id ?? "todo";
  const firstPerson = choices.people[0]?.id ?? state.currentUserId;
  const statusOptions = choices.statuses.map((option) => (
    <option key={option.id} value={option.id}>
      {option.label}
    </option>
  ));
  const priorityOptionsList = choices.priorities.map((option) => (
    <option key={option.id} value={option.id}>
      {option.label}
    </option>
  ));
  const groupOptions = choices.groups.map((group) => (
    <option key={group.id} value={group.id}>
      {group.name}
    </option>
  ));
  const peopleOptions = choices.people.map((person) => (
    <option key={person.id} value={person.id}>
      {person.name}
    </option>
  ));
  const fieldOptionsFor = (fieldId: string) =>
    (state.fields.find((field) => field.id === fieldId)?.options ?? []).map(
      (option) => (
        <option key={option.id} value={option.id}>
          {option.label}
        </option>
      ),
    );
  const firstOption = (fieldId: string) =>
    state.fields.find((field) => field.id === fieldId)?.options[0]?.id ?? "";

  const changeTrigger = (value: string): AutomationTrigger => {
    if (
      value === "task.created" ||
      value === "due.arrived" ||
      value === "due.overdue" ||
      value === "checklist.completed"
    )
      return { kind: value };
    if (value === "schedule")
      return {
        kind: "schedule",
        schedule: { every: "week", days: [1], time: "09:00" },
      };
    if (value === "comment.added")
      return { kind: "comment.added", mentionsOnly: false };
    if (value === "status.changed")
      return { kind: "status.changed", from: null, to: firstStatus };
    if (value === "assignee.added")
      return { kind: "assignee.added", userId: null };
    const field = value.slice(6);
    return {
      kind: "field.changed",
      field,
      value:
        field === "priority"
          ? "HIGH"
          : field === "group"
            ? (choices.groups[0]?.id ?? "")
            : firstOption(field),
    };
  };
  const { trigger } = draft;

  const subjectOf = (condition: AutomationCondition) =>
    condition.subject === "field"
      ? `field:${condition.fieldId}`
      : condition.subject;
  const newCondition = (subject: string): AutomationCondition => {
    if (subject === "status") return { subject, op: "is", value: firstStatus };
    if (subject === "priority") return { subject, op: "is", value: "HIGH" };
    if (subject === "group")
      return { subject, op: "is", value: choices.groups[0]?.id ?? null };
    if (subject === "assignees") return { subject, op: "empty" };
    if (subject === "due") return { subject, op: "set" };
    const fieldId = subject.slice(6);
    const field = state.fields.find((item) => item.id === fieldId);
    return {
      subject: "field",
      fieldId,
      op: "is",
      value: field?.type === "CHECKBOX" ? true : firstOption(fieldId),
    };
  };
  const setCondition = (index: number, next: AutomationCondition) =>
    set({
      conditions: draft.conditions.map((item, at) =>
        at === index ? next : item,
      ),
    });

  const actionKind = (action: AutomationAction) =>
    action.kind === "set.field"
      ? `field:${action.fieldId}`
      : action.kind === "set.date"
        ? `date:${action.field}`
        : action.kind;
  const newAction = (kind: string): AutomationAction => {
    if (kind === "set.status") return { kind, value: firstStatus };
    if (kind === "set.priority") return { kind, value: "HIGH" };
    if (kind === "set.group")
      return { kind, value: choices.groups[0]?.id ?? null };
    if (kind === "assign" || kind === "unassign")
      return { kind, userId: firstPerson };
    if (kind === "notify")
      return scheduled
        ? { kind, to: "people", userIds: [firstPerson] }
        : { kind, to: "assignees" };
    if (kind === "create.task")
      return {
        kind,
        boardId: null,
        name: scheduled ? draft.name || "New task" : "Follow up: {task}",
        assigneeIds: [],
        dueInDays: null,
      };
    if (kind === "webhook") return { kind, url: "" };
    if (kind === "email")
      return scheduled
        ? {
            kind,
            to: "people",
            userIds: [firstPerson],
            subject: "Reminder from {board}",
            message: "Time for the {rule}",
          }
        : {
            kind,
            to: "assignees",
            subject: "Heads up: {task}",
            message: "{task} is due {due}",
          };
    if (kind.startsWith("date:"))
      return { kind: "set.date", field: kind.slice(5), days: 3 };
    const fieldId = kind.slice(6);
    const field = state.fields.find((item) => item.id === fieldId);
    return {
      kind: "set.field",
      fieldId,
      value:
        field?.type === "CHECKBOX"
          ? true
          : field?.type === "TAGS"
            ? [firstOption(fieldId)]
            : firstOption(fieldId),
    };
  };
  const setAction = (index: number, next: AutomationAction) =>
    set({
      actions: draft.actions.map((item, at) => (at === index ? next : item)),
    });
  const move = (index: number, by: number) => {
    const actions = [...draft.actions];
    const [item] = actions.splice(index, 1);
    actions.splice(index + by, 0, item!);
    set({ actions });
  };

  // Which steps this board's approval policy will turn into requests.
  const approvalSteps = draft.actions.filter((action) => {
    const change: Record<string, unknown> =
      action.kind === "set.status"
        ? { statusId: action.value }
        : action.kind === "set.priority"
          ? { priority: action.value }
          : action.kind === "set.group"
            ? { groupId: action.value }
            : action.kind === "assign" || action.kind === "unassign"
              ? { assigneeIds: [] }
              : action.kind === "set.date"
                ? action.field === "dueDate" || action.field === "startDate"
                  ? { [action.field]: "" }
                  : { fieldValues: { [action.field]: "" } }
                : action.kind === "set.field"
                  ? { fieldValues: { [action.fieldId]: action.value } }
                  : {};
    return (
      Object.keys(change).length > 0 &&
      needsApproval(state.approvalPolicy, "UPDATE", change, state.fields)
    );
  });

  return (
    <PauseModal
      open
      onOpenChange={(next) => !next && onClose()}
      title={draft.id ? "Edit rule" : "New rule"}
      description="Read it like a sentence. Change any part from its dropdown."
      as="form"
      footer="Runs as you. Up to 10 actions."
      actions={
        <>
          <PauseClose asChild>
            <PauseButton type="button">Cancel</PauseButton>
          </PauseClose>
          <PauseButton
            tone="primary"
            type="submit"
            disabled={saving || !draft.name.trim() || !draft.actions.length}
          >
            {saving ? "Saving…" : "Save rule"}
          </PauseButton>
        </>
      }
      onSubmit={(event) => {
        event.preventDefault();
        onSave();
      }}
    >
      <label className="task-field-label">
        Rule name
        <Input
          aria-label="Rule name"
          required
          maxLength={80}
          data-autofocus
          placeholder="e.g. Ship it"
          value={draft.name}
          onChange={(event) => set({ name: event.target.value })}
        />
      </label>

      <label className="task-field-label">
        Applies to
        <select
          aria-label="Automation record scope"
          value={draft.recordScope ?? "ROOTS"}
          onChange={(e) =>
            set({
              recordScope: e.target.value as "ROOTS" | "SUBITEMS" | "BOTH",
            })
          }
        >
          <option value="ROOTS">Tasks</option>
          <option value="SUBITEMS">Subitems</option>
          <option value="BOTH">Tasks and subitems</option>
        </select>
      </label>
      <section className="automation-block" data-step="when">
        <h3>
          <i>1</i>When
        </h3>
        <div className="automation-line">
          <Pick
            label="Trigger"
            value={triggerValue(trigger)}
            onChange={(value) => {
              const next = changeTrigger(value);
              set(
                next.kind === "schedule"
                  ? {
                      trigger: next,
                      conditions: [],
                      actions: fitSchedule(draft.actions),
                    }
                  : { trigger: next },
              );
            }}
          >
            <option value="schedule">on a schedule</option>
            <option value="task.created">a task is created</option>
            {on.status && (
              <option value="status.changed">status changes</option>
            )}
            {on.assignees && (
              <option value="assignee.added">someone is assigned</option>
            )}
            {on.dueDate && (
              <option value="due.arrived">a task is due today</option>
            )}
            {on.dueDate && (
              <option value="due.overdue">a task becomes overdue</option>
            )}
            <option value="comment.added">a comment is added</option>
            {on.checklist && (
              <option value="checklist.completed">
                the checklist is completed
              </option>
            )}
            {on.priority && (
              <option value="field:priority">priority changes</option>
            )}
            {choices.groups.length > 0 && (
              <option value="field:group">a task moves to a group</option>
            )}
            {choices.selectFields.map((field) => (
              <option key={field.id} value={`field:${field.id}`}>
                {field.name} changes
              </option>
            ))}
          </Pick>
          {trigger.kind === "status.changed" && (
            <>
              <span>from</span>
              <Pick
                label="From status"
                value={trigger.from ?? ""}
                onChange={(value) =>
                  set({ trigger: { ...trigger, from: value || null } })
                }
              >
                <option value="">any status</option>
                {statusOptions}
              </Pick>
              <span>to</span>
              <Pick
                label="To status"
                value={trigger.to}
                onChange={(value) =>
                  set({ trigger: { ...trigger, to: value } })
                }
              >
                {statusOptions}
              </Pick>
            </>
          )}
          {trigger.kind === "assignee.added" && (
            <Pick
              label="Assigned person"
              value={trigger.userId ?? ""}
              onChange={(value) =>
                set({ trigger: { ...trigger, userId: value || null } })
              }
            >
              <option value="">anyone</option>
              {peopleOptions}
            </Pick>
          )}
          {trigger.kind === "comment.added" && (
            <Pick
              label="Which comments"
              value={trigger.mentionsOnly ? "mentions" : "any"}
              onChange={(value) =>
                set({
                  trigger: { ...trigger, mentionsOnly: value === "mentions" },
                })
              }
            >
              <option value="any">any comment</option>
              <option value="mentions">only when it mentions someone</option>
            </Pick>
          )}
          {trigger.kind === "schedule" && (
            <SchedulePicker
              schedule={trigger.schedule}
              onChange={(schedule) =>
                set({ trigger: { ...trigger, schedule } })
              }
            />
          )}
          {trigger.kind === "field.changed" && (
            <>
              <span>to</span>
              <Pick
                label="Changes to"
                value={trigger.value}
                onChange={(value) => set({ trigger: { ...trigger, value } })}
              >
                {trigger.field === "priority"
                  ? priorityOptionsList
                  : trigger.field === "group"
                    ? groupOptions
                    : fieldOptionsFor(trigger.field)}
              </Pick>
            </>
          )}
        </div>
        {trigger.kind === "schedule" && (
          <p className="automation-next">
            {(() => {
              const next = nextOccurrence(
                trigger.schedule,
                new Date(),
                meta.timezone,
              );
              return next
                ? `Next run: ${when(next.toISOString(), meta.timezone)} (${meta.timezone})`
                : "Choose when it runs.";
            })()}
          </p>
        )}
      </section>

      {scheduled ? (
        <p className="automation-note">
          Scheduled rules have no task to check, so there&apos;s no If step.
        </p>
      ) : (
        <section className="automation-block" data-step="if">
          <h3>
            <i>2</i>If
            {draft.conditions.length > 1 ? (
              <span
                className="automation-match"
                role="radiogroup"
                aria-label="Conditions must"
              >
                {(["all", "any"] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={(draft.match ?? "all") === value}
                    onClick={() => set({ match: value })}
                  >
                    {value === "all" ? "all match" : "any matches"}
                  </button>
                ))}
              </span>
            ) : (
              <small>optional</small>
            )}
          </h3>
          {draft.conditions.map((condition, index) => (
            <div className="automation-line" key={index}>
              <Pick
                label={`Condition ${index + 1} subject`}
                value={subjectOf(condition)}
                onChange={(value) => setCondition(index, newCondition(value))}
              >
                {on.status && <option value="status">Status</option>}
                {on.priority && <option value="priority">Priority</option>}
                {choices.groups.length > 0 && (
                  <option value="group">Group</option>
                )}
                {on.assignees && <option value="assignees">Assignees</option>}
                {on.dueDate && <option value="due">Due date</option>}
                {[...choices.selectFields, ...choices.checkFields].map(
                  (field) => (
                    <option key={field.id} value={`field:${field.id}`}>
                      {field.name}
                    </option>
                  ),
                )}
              </Pick>
              {(condition.subject === "status" ||
                condition.subject === "priority" ||
                condition.subject === "group") && (
                <>
                  <Pick
                    label={`Condition ${index + 1} test`}
                    value={condition.op}
                    onChange={(op) =>
                      setCondition(index, {
                        ...condition,
                        op: op as "is" | "is_not",
                      })
                    }
                  >
                    <option value="is">is</option>
                    <option value="is_not">is not</option>
                  </Pick>
                  <Pick
                    label={`Condition ${index + 1} value`}
                    value={condition.value ?? ""}
                    onChange={(value) =>
                      setCondition(index, {
                        ...condition,
                        value: value || null,
                      })
                    }
                  >
                    {condition.subject === "status" ? (
                      <>
                        <option value="">No status</option>
                        {statusOptions}
                      </>
                    ) : condition.subject === "priority" ? (
                      priorityOptionsList
                    ) : (
                      <>
                        <option value="">No group</option>
                        {groupOptions}
                      </>
                    )}
                  </Pick>
                </>
              )}
              {condition.subject === "assignees" && (
                <>
                  <Pick
                    label={`Condition ${index + 1} test`}
                    value={
                      condition.op === "empty" ? "" : (condition.userId ?? "")
                    }
                    onChange={(value) =>
                      setCondition(
                        index,
                        value
                          ? {
                              subject: "assignees",
                              op: "include",
                              userId: value,
                            }
                          : { subject: "assignees", op: "empty" },
                      )
                    }
                  >
                    <option value="">are empty</option>
                    {choices.people.map((person) => (
                      <option key={person.id} value={person.id}>
                        include {person.name}
                      </option>
                    ))}
                  </Pick>
                </>
              )}
              {condition.subject === "due" && (
                <Pick
                  label={`Condition ${index + 1} test`}
                  value={condition.op}
                  onChange={(op) =>
                    setCondition(index, {
                      subject: "due",
                      op: op as "set" | "unset",
                    })
                  }
                >
                  <option value="set">is set</option>
                  <option value="unset">is empty</option>
                </Pick>
              )}
              {condition.subject === "field" &&
                (typeof condition.value === "boolean" ? (
                  <Pick
                    label={`Condition ${index + 1} test`}
                    value={String(condition.value)}
                    onChange={(value) =>
                      setCondition(index, {
                        ...condition,
                        op: "is",
                        value: value === "true",
                      })
                    }
                  >
                    <option value="true">is checked</option>
                    <option value="false">is not checked</option>
                  </Pick>
                ) : (
                  <>
                    <Pick
                      label={`Condition ${index + 1} test`}
                      value={condition.op}
                      onChange={(op) =>
                        setCondition(index, {
                          ...condition,
                          op: op as "is" | "is_not",
                        })
                      }
                    >
                      <option value="is">is</option>
                      <option value="is_not">is not</option>
                    </Pick>
                    <Pick
                      label={`Condition ${index + 1} value`}
                      value={String(condition.value)}
                      onChange={(value) =>
                        setCondition(index, { ...condition, value })
                      }
                    >
                      {fieldOptionsFor(condition.fieldId)}
                    </Pick>
                  </>
                ))}
              <button
                type="button"
                className="automation-remove"
                aria-label={`Remove condition ${index + 1}`}
                onClick={() =>
                  set({
                    conditions: draft.conditions.filter(
                      (_, at) => at !== index,
                    ),
                  })
                }
              >
                <X size={14} />
              </button>
            </div>
          ))}
          {draft.conditions.length < 10 && (
            <button
              type="button"
              className="automation-add"
              onClick={() =>
                set({
                  conditions: [...draft.conditions, newCondition("priority")],
                })
              }
            >
              <Plus size={13} /> Add condition
            </button>
          )}
        </section>
      )}

      <section className="automation-block" data-step="then">
        <h3>
          <i>{scheduled ? 2 : 3}</i>Then
        </h3>
        {draft.actions.map((action, index) => (
          <div className="automation-line" key={index}>
            <span className="automation-order">
              <button
                type="button"
                aria-label={`Move action ${index + 1} up`}
                disabled={index === 0}
                onClick={() => move(index, -1)}
              >
                <ArrowUp size={12} />
              </button>
              <button
                type="button"
                aria-label={`Move action ${index + 1} down`}
                disabled={index === draft.actions.length - 1}
                onClick={() => move(index, 1)}
              >
                <ArrowDown size={12} />
              </button>
            </span>
            <Pick
              label={`Action ${index + 1}`}
              value={actionKind(action)}
              onChange={(value) => setAction(index, newAction(value))}
            >
              <option value="notify">Notify</option>
              <option value="email">Send an email</option>
              <option value="create.task">Create a task</option>
              {(meta.canWebhook || action.kind === "webhook") && (
                <option value="webhook">Send a webhook</option>
              )}
              {!scheduled && (
                <>
                  {on.status && <option value="set.status">Set status</option>}
                  {on.priority && (
                    <option value="set.priority">Set priority</option>
                  )}
                  {choices.groups.length > 0 && (
                    <option value="set.group">Move to group</option>
                  )}
                  {on.assignees && <option value="assign">Assign</option>}
                  {on.assignees && <option value="unassign">Unassign</option>}
                  {on.dueDate && (
                    <option value="date:dueDate">Set due date</option>
                  )}
                  {on.startDate && (
                    <option value="date:startDate">Set start date</option>
                  )}
                  {choices.dateFields.map((field) => (
                    <option key={field.id} value={`date:${field.id}`}>
                      Set {field.name}
                    </option>
                  ))}
                  {[...choices.selectFields, ...choices.checkFields].map(
                    (field) => (
                      <option key={field.id} value={`field:${field.id}`}>
                        Set {field.name}
                      </option>
                    ),
                  )}
                </>
              )}
            </Pick>
            {action.kind === "create.task" && (
              <>
                <span>on</span>
                <Pick
                  label={`Action ${index + 1} board`}
                  value={action.boardId ?? ""}
                  onChange={(value) =>
                    setAction(index, {
                      ...action,
                      boardId: value || null,
                      // Statuses belong to this board only.
                      statusId: undefined,
                      groupId: undefined,
                    })
                  }
                >
                  <option value="">this board</option>
                  {meta.boards.map((board) => (
                    <option key={board.id} value={board.id}>
                      {board.name}
                    </option>
                  ))}
                </Pick>
                <div className="automation-subline">
                  <span>named</span>
                  <input
                    aria-label={`Action ${index + 1} task name`}
                    className="automation-text"
                    maxLength={200}
                    value={action.name}
                    placeholder={
                      scheduled ? "Weekly report" : "Follow up: {task}"
                    }
                    onChange={(event) =>
                      setAction(index, { ...action, name: event.target.value })
                    }
                  />
                </div>
                <div className="automation-subline">
                  {!action.boardId && (
                    <>
                      <span>in</span>
                      <Pick
                        label={`Action ${index + 1} status`}
                        value={action.statusId ?? ""}
                        onChange={(value) =>
                          setAction(index, {
                            ...action,
                            statusId: value || undefined,
                          })
                        }
                      >
                        <option value="">the first status</option>
                        {statusOptions}
                      </Pick>
                    </>
                  )}
                  <span>for</span>
                  <Pick
                    label={`Action ${index + 1} assignee`}
                    value={action.assigneeIds[0] ?? ""}
                    onChange={(value) =>
                      setAction(index, {
                        ...action,
                        assigneeIds: value ? [value] : [],
                      })
                    }
                  >
                    <option value="">nobody yet</option>
                    {peopleOptions}
                  </Pick>
                  <span>due</span>
                  <Pick
                    label={`Action ${index + 1} due`}
                    value={
                      action.dueInDays === null
                        ? "none"
                        : String(action.dueInDays)
                    }
                    onChange={(value) =>
                      setAction(index, {
                        ...action,
                        dueInDays: value === "none" ? null : Number(value),
                      })
                    }
                  >
                    <option value="none">no due date</option>
                    <option value="0">today</option>
                    <option value="1">tomorrow</option>
                    <option value="3">in 3 days</option>
                    <option value="4">in 4 days</option>
                    <option value="7">in a week</option>
                    <option value="14">in 2 weeks</option>
                  </Pick>
                </div>
              </>
            )}
            {action.kind === "webhook" && (
              <>
                <span>to</span>
                <input
                  aria-label={`Action ${index + 1} webhook URL`}
                  className="automation-text automation-url"
                  type="url"
                  inputMode="url"
                  placeholder="https://hooks.example.com/yuzu"
                  disabled={!meta.canWebhook}
                  value={action.url}
                  onChange={(event) =>
                    setAction(index, { ...action, url: event.target.value })
                  }
                />
              </>
            )}
            {action.kind === "notify" && (
              <>
                <Pick
                  label={`Action ${index + 1} who`}
                  value={
                    action.to === "people"
                      ? `person:${action.userIds?.[0] ?? ""}`
                      : action.to
                  }
                  onChange={(value) =>
                    setAction(
                      index,
                      value.startsWith("person:")
                        ? {
                            kind: "notify",
                            to: "people",
                            userIds: [value.slice(7)],
                            message: action.message,
                            replaceDefault: action.replaceDefault,
                          }
                        : {
                            kind: "notify",
                            to: value as "assignees" | "creator",
                            message: action.message,
                            replaceDefault: action.replaceDefault,
                          },
                    )
                  }
                >
                  {!scheduled && (
                    <>
                      {on.assignees && (
                        <option value="assignees">the assignees</option>
                      )}
                      <option value="creator">the creator</option>
                    </>
                  )}
                  {choices.people.map((person) => (
                    <option key={person.id} value={`person:${person.id}`}>
                      {person.name}
                    </option>
                  ))}
                </Pick>
                <MessageField
                  index={index}
                  value={action.message ?? ""}
                  scheduled={scheduled}
                  onChange={(message) =>
                    setAction(index, {
                      ...action,
                      message: message || undefined,
                    })
                  }
                />
                {!scheduled && (
                  <label className="automation-replace">
                    <input
                      type="checkbox"
                      checked={Boolean(action.replaceDefault)}
                      onChange={(event) =>
                        setAction(index, {
                          ...action,
                          replaceDefault: event.target.checked || undefined,
                        })
                      }
                    />
                    Replace Yuzu&apos;s own notification
                    <small>
                      People get only this message instead of the usual
                      &ldquo;assigned you&rdquo; or &ldquo;mentioned you&rdquo;
                      notice.
                    </small>
                  </label>
                )}
              </>
            )}
            {action.kind === "email" && (
              <>
                <span>to</span>
                <Pick
                  label={`Action ${index + 1} who`}
                  value={
                    action.to === "people"
                      ? `person:${action.userIds?.[0] ?? ""}`
                      : action.to
                  }
                  onChange={(value) =>
                    setAction(
                      index,
                      value.startsWith("person:")
                        ? {
                            ...action,
                            to: "people",
                            userIds: [value.slice(7)],
                          }
                        : {
                            ...action,
                            to: value as "assignees" | "creator",
                            userIds: undefined,
                          },
                    )
                  }
                >
                  {!scheduled && (
                    <>
                      {on.assignees && (
                        <option value="assignees">the assignees</option>
                      )}
                      <option value="creator">the creator</option>
                    </>
                  )}
                  {choices.people.map((person) => (
                    <option key={person.id} value={`person:${person.id}`}>
                      {person.name}
                    </option>
                  ))}
                </Pick>
                <MessageField
                  index={index}
                  name="subject"
                  caption="Subject"
                  chips={false}
                  maxLength={150}
                  placeholder={`Subject (optional), e.g. ${scheduled ? "Reminder from {board}" : "Heads up: {task}"}`}
                  value={action.subject ?? ""}
                  scheduled={scheduled}
                  onChange={(subject) =>
                    setAction(index, {
                      ...action,
                      subject: subject || undefined,
                    })
                  }
                />
                <MessageField
                  index={index}
                  maxLength={1000}
                  caption="Email"
                  placeholder={`Email text, e.g. ${scheduled ? "Time for the {rule}" : "{task} is due {due}"}`}
                  value={action.message}
                  scheduled={scheduled}
                  onChange={(message) =>
                    setAction(index, { ...action, message })
                  }
                />
                <small className="automation-email-note">
                  Sent right away to people who have email set up, with a link
                  back to {scheduled ? "the board" : "the task"}.
                </small>
              </>
            )}
            {(action.kind === "set.status" ||
              action.kind === "set.priority") && (
              <Pick
                label={`Action ${index + 1} value`}
                value={action.value}
                onChange={(value) => setAction(index, { ...action, value })}
              >
                {action.kind === "set.status"
                  ? statusOptions
                  : priorityOptionsList}
              </Pick>
            )}
            {action.kind === "set.group" && (
              <Pick
                label={`Action ${index + 1} value`}
                value={action.value ?? ""}
                onChange={(value) =>
                  setAction(index, { ...action, value: value || null })
                }
              >
                <option value="">No group</option>
                {groupOptions}
              </Pick>
            )}
            {(action.kind === "assign" || action.kind === "unassign") && (
              <Pick
                label={`Action ${index + 1} person`}
                value={action.userId}
                onChange={(userId) => setAction(index, { ...action, userId })}
              >
                {peopleOptions}
              </Pick>
            )}
            {action.kind === "set.date" && (
              <>
                <span>to</span>
                <Pick
                  label={`Action ${index + 1} date`}
                  value={action.days === null ? "clear" : String(action.days)}
                  onChange={(value) =>
                    setAction(index, {
                      ...action,
                      days: value === "clear" ? null : Number(value),
                    })
                  }
                >
                  <option value="0">today</option>
                  <option value="1">tomorrow</option>
                  <option value="3">in 3 days</option>
                  <option value="7">in a week</option>
                  <option value="14">in 2 weeks</option>
                  <option value="30">in 30 days</option>
                  <option value="clear">nothing (clear it)</option>
                </Pick>
              </>
            )}
            {action.kind === "set.field" &&
              (typeof action.value === "boolean" ? (
                <Pick
                  label={`Action ${index + 1} value`}
                  value={String(action.value)}
                  onChange={(value) =>
                    setAction(index, { ...action, value: value === "true" })
                  }
                >
                  <option value="true">checked</option>
                  <option value="false">not checked</option>
                </Pick>
              ) : (
                <>
                  <span>to</span>
                  <Pick
                    label={`Action ${index + 1} value`}
                    value={
                      Array.isArray(action.value)
                        ? (action.value[0] ?? "")
                        : (action.value ?? "")
                    }
                    onChange={(value) =>
                      setAction(index, {
                        ...action,
                        value: Array.isArray(action.value) ? [value] : value,
                      })
                    }
                  >
                    {fieldOptionsFor(action.fieldId)}
                  </Pick>
                </>
              ))}
            <button
              type="button"
              className="automation-remove"
              aria-label={`Remove action ${index + 1}`}
              disabled={draft.actions.length === 1}
              onClick={() =>
                set({ actions: draft.actions.filter((_, at) => at !== index) })
              }
            >
              <X size={14} />
            </button>
          </div>
        ))}
        {draft.actions.length < 10 && (
          <button
            type="button"
            className="automation-add"
            onClick={() =>
              set({ actions: [...draft.actions, newAction("notify")] })
            }
          >
            <Plus size={13} /> Add action
          </button>
        )}
      </section>

      <div className="automation-preview" aria-live="polite">
        <Sentence parts={describeRule(draft, labels)} />
      </div>
      {draft.actions.some((action) => action.kind === "webhook") && (
        <p className="automation-note">
          Only owners and admins can add webhooks. Deliveries are signed with a
          secret shown once after you save.
        </p>
      )}
      {approvalSteps.length > 0 && (
        <p className="automation-approval">
          {approvalSteps.length === 1
            ? "One step changes a field that needs approval on this board, so it will be sent for approval instead of applying."
            : `${approvalSteps.length} steps change fields that need approval on this board, so they will be sent for approval instead of applying.`}
        </p>
      )}
      {error && <PauseAlert intent="danger">{error}</PauseAlert>}
    </PauseModal>
  );
}

function SchedulePicker({
  schedule,
  onChange,
}: {
  schedule: Schedule;
  onChange: (schedule: Schedule) => void;
}) {
  return (
    <>
      <span>every</span>
      <Pick
        label="Repeats"
        value={schedule.every}
        onChange={(every) =>
          onChange({
            every: every as Schedule["every"],
            time: schedule.time,
            ...(every === "week"
              ? { days: schedule.days?.length ? schedule.days : [1] }
              : {}),
            ...(every === "month" ? { date: schedule.date ?? 1 } : {}),
          })
        }
      >
        <option value="day">day</option>
        <option value="weekday">weekday</option>
        <option value="week">week</option>
        <option value="month">month</option>
      </Pick>
      {schedule.every === "week" && (
        <>
          <span>on</span>
          <span className="automation-days" role="group" aria-label="Days">
            {weekdays.map(([name, day]) => {
              const on = schedule.days?.includes(day) ?? false;
              return (
                <button
                  key={name}
                  type="button"
                  aria-label={name}
                  aria-pressed={on}
                  onClick={() => {
                    const days = on
                      ? (schedule.days ?? []).filter((item) => item !== day)
                      : [...(schedule.days ?? []), day];
                    if (days.length) onChange({ ...schedule, days });
                  }}
                >
                  {name.charAt(0)}
                </button>
              );
            })}
          </span>
        </>
      )}
      {schedule.every === "month" && (
        <>
          <span>on day</span>
          <Pick
            label="Day of the month"
            value={String(schedule.date ?? 1)}
            onChange={(date) => onChange({ ...schedule, date: Number(date) })}
          >
            {Array.from({ length: 31 }, (_, at) => (
              <option key={at} value={at + 1}>
                {at + 1}
              </option>
            ))}
          </Pick>
        </>
      )}
      <span>at</span>
      <input
        type="time"
        aria-label="Time"
        className="automation-pick automation-time"
        value={schedule.time}
        onChange={(event) =>
          event.target.value &&
          onChange({ ...schedule, time: event.target.value })
        }
      />
    </>
  );
}

/** A step's own words, with placeholders filled in when it runs. */
function MessageField({
  index,
  value,
  scheduled,
  onChange,
  name = "message",
  maxLength = 280,
  placeholder,
  caption,
  chips = true,
}: {
  index: number;
  value: string;
  scheduled: boolean;
  onChange: (value: string) => void;
  name?: string;
  maxLength?: number;
  placeholder?: string;
  /** A visible label, for steps with more than one text field. */
  caption?: string;
  chips?: boolean;
}) {
  const fields = scheduled
    ? messageFields.filter((field) =>
        ["board", "rule", "date"].includes(field.key),
      )
    : messageFields;
  return (
    <div className="automation-message">
      {caption && (
        <span className="automation-caption" aria-hidden="true">
          {caption}
        </span>
      )}
      <input
        aria-label={`Action ${index + 1} ${name}`}
        className="automation-text"
        maxLength={maxLength}
        value={value}
        placeholder={
          placeholder ??
          `Message (optional), e.g. ${scheduled ? "Time for the {rule}" : "{task} just shipped 🎉 It's now {status}"}`
        }
        onChange={(event) => onChange(event.target.value)}
      />
      {chips && (
        <span
          className="automation-chips"
          aria-label={`Insert a placeholder into the ${name}`}
        >
          {fields.map((field) => (
            <button
              key={field.key}
              type="button"
              title={`Inserts ${field.hint}`}
              onClick={() =>
                onChange(
                  `${value}${value && !value.endsWith(" ") ? " " : ""}{${field.key}}`,
                )
              }
            >
              {`{${field.key}}`}
            </button>
          ))}
        </span>
      )}
    </div>
  );
}

// ---------- Run history ----------

const outcomeLabel: Record<AutomationRun["outcome"], string> = {
  APPLIED: "Applied",
  SKIPPED: "Skipped",
  PENDING_APPROVAL: "Sent for approval",
  FAILED: "Failed",
};
const triggerLabel: Record<string, string> = {
  "task.created": "Task created",
  "task.changed": "Task changed",
  "due.arrived": "Due today",
  "due.overdue": "Overdue",
  "comment.added": "Comment added",
  schedule: "Schedule",
};

function RunHistory({
  rule,
  state,
  onClose,
}: {
  rule: AutomationRule;
  state: BoardState;
  onClose: () => void;
}) {
  const [filter, setFilter] = useState<AutomationRun["outcome"] | "ALL">("ALL");
  const runs = useQuery({
    queryKey: [
      "principal",
      state.currentUserId,
      "automations",
      "runs",
      rule.id,
    ],
    refetchInterval: 15_000,
    queryFn: async ({ signal }) =>
      z.object({ runs: z.array(automationRunSchema) }).parse(
        (
          await apiRequest(`/api/v1/automations/runs?ruleId=${rule.id}`, {
            signal,
            cache: "no-store",
          })
        ).data,
      ).runs,
  });
  const all = runs.data ?? [];
  const count = (outcome: AutomationRun["outcome"]) =>
    all.filter((run) => run.outcome === outcome).length;
  const shown =
    filter === "ALL" ? all : all.filter((run) => run.outcome === filter);
  return (
    <PauseModal
      open
      onOpenChange={(next) => !next && onClose()}
      title={`${rule.name}: runs`}
      description="The last 30 days, newest first."
      footer="Each run reloads the task and checks the conditions again."
      actions={
        <PauseClose asChild>
          <PauseButton>Done</PauseButton>
        </PauseClose>
      }
    >
      <div
        className="automation-filters"
        role="radiogroup"
        aria-label="Show runs"
      >
        {(
          ["ALL", "APPLIED", "SKIPPED", "PENDING_APPROVAL", "FAILED"] as const
        ).map((value) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={filter === value}
            onClick={() => setFilter(value)}
          >
            {value === "ALL" ? "All" : outcomeLabel[value]}{" "}
            {value === "ALL" ? all.length : count(value)}
          </button>
        ))}
      </div>
      {runs.error && (
        <PauseAlert intent="danger">{runs.error.message}</PauseAlert>
      )}
      {runs.isPending && (
        <p role="status" className="text-sm text-muted-foreground">
          Loading runs…
        </p>
      )}
      {!runs.isPending && !shown.length && (
        <p className="automation-empty-runs">
          {all.length
            ? "No runs with this outcome."
            : "This rule hasn't run yet."}
        </p>
      )}
      <ol className="automation-runs">
        {shown.map((run) => (
          <li key={run.id}>
            <time dateTime={run.createdAt}>{ago(run.createdAt)}</time>
            <div>
              {run.taskId ? (
                <Link href={`/boards/${state.boardId}?task=${run.taskId}`}>
                  {run.taskName}
                </Link>
              ) : (
                <b>{run.missed ? "Schedule (missed)" : "Schedule"}</b>
              )}
              <small>
                {run.missed
                  ? "Yuzu was off at the scheduled time, so it ran once on return. "
                  : run.depth > 0
                    ? `Triggered by another rule (step ${run.depth}). `
                    : `${triggerLabel[run.trigger] ?? run.trigger}. `}
                {run.detail}
              </small>
              {run.createdTask && (
                <small>
                  Created{" "}
                  <Link
                    href={`/boards/${run.createdTask.boardId}?task=${run.createdTask.id}`}
                  >
                    {run.createdTask.name}
                  </Link>
                  {run.createdTask.boardId !== state.boardId
                    ? " on another board"
                    : ""}
                  .
                </small>
              )}
              {run.deliveries.map((delivery, at) => (
                <small key={at} className="automation-delivery">
                  Webhook{" "}
                  <span data-status={delivery.status}>
                    {delivery.status === "DELIVERED"
                      ? `${delivery.responseCode ?? "ok"}`
                      : delivery.status === "PENDING"
                        ? "sending"
                        : `failed`}
                  </span>
                  {delivery.durationMs !== null &&
                  delivery.status === "DELIVERED"
                    ? ` in ${delivery.durationMs} ms`
                    : delivery.attempts > 1
                      ? `, ${delivery.attempts} attempts`
                      : ""}
                  {delivery.error && delivery.status !== "DELIVERED"
                    ? ` · ${delivery.error}`
                    : ""}
                </small>
              ))}
            </div>
            <span className="automation-outcome" data-outcome={run.outcome}>
              {outcomeLabel[run.outcome]}
            </span>
          </li>
        ))}
      </ol>
    </PauseModal>
  );
}
