"use client";
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
import { coreKeys, type BoardState } from "@/lib/board-contract";
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
  id?: string;
  revision?: number;
  name: string;
  trigger: AutomationTrigger;
  conditions: AutomationCondition[];
  actions: AutomationAction[];
};

/** Everything the builder offers, read from the board. */
function boardChoices(state: BoardState) {
  const statuses =
    state.fields.find((field) => field.key === "status")?.options ?? [];
  const custom = state.fields.filter((field) => !coreKeys.includes(field.key));
  return {
    statuses,
    priorities: priorityOptions(state),
    groups: state.groups,
    people: state.people,
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
      z
        .object({ rules: z.array(automationRuleSchema) })
        .parse(
          (
            await apiRequest(
              `/api/v1/automations/list?boardId=${state.boardId}`,
              { signal, cache: "no-store" },
            )
          ).data,
        ).rules,
  });
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
    onSuccess: (_result, { action }) => {
      if (action === "save") setDraft(null);
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
  const list = rules.data ?? [];
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
                          name: rule.name,
                          trigger: rule.trigger,
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
                {templates(choices, state.currentUserId).map((template) => (
                  <button
                    key={template.name}
                    type="button"
                    onClick={() => start(template)}
                  >
                    {template.name}
                  </button>
                ))}
              </div>
            </section>
          </div>
        </SheetContent>
      </Sheet>
      {draft && (
        <RuleBuilder
          draft={draft}
          state={state}
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
  ];
}

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
  labels,
  saving,
  error,
  onChange,
  onClose,
  onSave,
}: {
  draft: Draft;
  state: BoardState;
  labels: RuleLabels;
  saving: boolean;
  error?: string;
  onChange: (draft: Draft) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  const choices = boardChoices(state);
  const set = (patch: Partial<Draft>) => onChange({ ...draft, ...patch });
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
      value === "due.overdue"
    )
      return { kind: value };
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
    if (kind === "notify") return { kind, to: "assignees" };
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

      <section className="automation-block" data-step="when">
        <h3>
          <i>1</i>When
        </h3>
        <div className="automation-line">
          <Pick
            label="Trigger"
            value={triggerValue(trigger)}
            onChange={(value) => set({ trigger: changeTrigger(value) })}
          >
            <option value="task.created">a task is created</option>
            <option value="status.changed">status changes</option>
            <option value="assignee.added">someone is assigned</option>
            <option value="due.arrived">a task is due today</option>
            <option value="due.overdue">a task becomes overdue</option>
            <option value="field:priority">priority changes</option>
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
      </section>

      <section className="automation-block" data-step="if">
        <h3>
          <i>2</i>If <small>optional, all must match</small>
        </h3>
        {draft.conditions.map((condition, index) => (
          <div className="automation-line" key={index}>
            <Pick
              label={`Condition ${index + 1} subject`}
              value={subjectOf(condition)}
              onChange={(value) => setCondition(index, newCondition(value))}
            >
              <option value="status">Status</option>
              <option value="priority">Priority</option>
              {choices.groups.length > 0 && (
                <option value="group">Group</option>
              )}
              <option value="assignees">Assignees</option>
              <option value="due">Due date</option>
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
                    setCondition(index, { ...condition, value: value || null })
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
                        ? { subject: "assignees", op: "include", userId: value }
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
                  conditions: draft.conditions.filter((_, at) => at !== index),
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

      <section className="automation-block" data-step="then">
        <h3>
          <i>3</i>Then
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
              <option value="set.status">Set status</option>
              <option value="set.priority">Set priority</option>
              {choices.groups.length > 0 && (
                <option value="set.group">Move to group</option>
              )}
              <option value="assign">Assign</option>
              <option value="unassign">Unassign</option>
              <option value="date:dueDate">Set due date</option>
              <option value="date:startDate">Set start date</option>
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
            </Pick>
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
                          }
                        : {
                            kind: "notify",
                            to: value as "assignees" | "creator",
                          },
                    )
                  }
                >
                  <option value="assignees">the assignees</option>
                  <option value="creator">the creator</option>
                  {choices.people.map((person) => (
                    <option key={person.id} value={`person:${person.id}`}>
                      {person.name}
                    </option>
                  ))}
                </Pick>
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
              <Link href={`/boards/${state.boardId}?task=${run.taskId}`}>
                {run.taskName}
              </Link>
              <small>
                {run.depth > 0
                  ? `Triggered by another rule (step ${run.depth}). `
                  : `${triggerLabel[run.trigger] ?? run.trigger}. `}
                {run.detail}
              </small>
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
