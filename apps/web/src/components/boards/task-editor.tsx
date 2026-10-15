"use client";
import { useState } from "react";
import { createRecordId } from "@yuzu/database/ids";
import { needsApproval } from "@/lib/approval-rules";
import Link from "next/link";
import { taskDraft, reconcileTaskDraft, editTaskDraft } from "@/lib/task-sync";
import { createStore } from "zustand/vanilla";
import { useStore } from "zustand";
import {
  Archive,
  CalendarDays,
  Flag,
  ListChecks,
  FileText,
  SlidersHorizontal,
  Users,
  Check,
  History,
  Plus,
  Trash2,
} from "lucide-react";
import { TaskComments } from "./task-comments";
import { TaskFiles } from "./task-files";
import {
  AssigneeAvatars,
  StatusIcon,
  optionBadgeStyle,
  formatDueDate,
  priorityOptions,
} from "./board-presentation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SheetTitle, SheetDescription } from "@/components/ui/sheet";
import {
  coreKeys,
  type BoardState,
  type BoardTask,
  type FieldValue,
} from "@/lib/board-contract";

export function TaskEditor({
  state,
  task,
  pending,
  error,
  onSubmit,
  onAction,
  initialTab = "details",
  onNotice,
  syncInterval = 15_000,
}: {
  state: BoardState;
  task?: BoardTask;
  pending: boolean;
  syncInterval?: number;
  error?: string;
  onSubmit: (input: unknown) => void;
  onAction: (action: string, input: unknown) => void;
  initialTab?: "details" | "comments";
  onNotice: (message: string, kind: "success" | "error") => void;
}) {
  const [store] = useState(() =>
    createStore(() => ({
      name: task?.name ?? "",
      description: task?.description ?? "",
      checklist: task?.checklist ?? [],
      statusId: task
        ? (task.statusId ?? "")
        : (state.fields.find((field) => field.key === "status")?.options[0]
            ?.id ?? ""),
      priority: task?.priority ?? "NORMAL",
      dueDate: task?.dueDate ?? "",
      groupId: task ? (task.groupId ?? "") : (state.groups[0]?.id ?? ""),
      assigneeIds: task?.assigneeIds ?? ([] as string[]),
      fieldValues: task?.fieldValues ?? ({} as Record<string, FieldValue>),
    })),
  );
  const localDraft = useStore(store);
  const [baseline, setBaseline] = useState(() =>
    task ? taskDraft(task) : null,
  );
  const merged =
    task && baseline
      ? reconcileTaskDraft(
          baseline,
          {
            ...localDraft,
            statusId: localDraft.statusId || null,
            dueDate: localDraft.dueDate || null,
            groupId: localDraft.groupId || null,
          },
          taskDraft(task),
        )
      : null;
  const draft = merged
    ? {
        ...merged.draft,
        statusId: merged.draft.statusId ?? "",
        dueDate: merged.draft.dueDate ?? "",
        groupId: merged.draft.groupId ?? "",
      }
    : localDraft;
  const conflicts = merged?.conflicts ?? [];
  const requiresApproval = needsApproval(
    state.approvalPolicy,
    task ? "UPDATE" : "CREATE",
    merged?.changes ?? {},
    state.fields,
  );
  const completionRequiresApproval = needsApproval(
    state.approvalPolicy,
    "UPDATE",
    { ...merged?.changes, statusId: "done" },
    state.fields,
  );
  const fieldLabels: Record<string, string> = {
    name: "Task name",
    description: "Description",
    checklist: "Checklist",
    statusId: "Status",
    priority: "Priority",
    dueDate: "Target date",
    groupId: "Group",
    assigneeIds: "Assignees",
  };
  const acceptLatest = (keepEdits: boolean) => {
    if (!task || !merged) return;
    const next = keepEdits ? merged.draft : taskDraft(task);
    setBaseline(taskDraft(task));
    setCreateKey(crypto.randomUUID());
    store.setState({
      ...next,
      statusId: next.statusId ?? "",
      dueDate: next.dueDate ?? "",
      groupId: next.groupId ?? "",
    });
  };
  const [createKey, setCreateKey] = useState(() => crypto.randomUUID());
  const [tab, setTab] = useState<"details" | "comments" | "activity" | "files">(
    task ? initialTab : "details",
  );
  const [accessPerson, setAccessPerson] = useState("");
  const [newChecklistItem, setNewChecklistItem] = useState("");
  const editable = !task || task.canEdit;
  const statusOptions =
    state.fields.find((field) => field.key === "status")?.options ?? [];
  const customFields = state.fields.filter(
    (field) => !coreKeys.includes(field.key) && field.type !== "MULTI_SELECT",
  );
  const checklistFields = state.fields.filter(
    (field) => field.type === "MULTI_SELECT",
  );
  const selectedStatus = statusOptions.find(
    (option) => option.id === draft.statusId,
  );
  const priorityChoices = priorityOptions(state);
  const selectedPriority = priorityChoices.find(
    (option) => option.id === draft.priority,
  );
  const submissionChanges = () => ({
    ...draft,
    statusId: draft.statusId || null,
    groupId: draft.groupId || null,
    dueDate: draft.dueDate || null,
  });
  const editDraft = (patch: Partial<typeof localDraft>) => {
    const current = store.getState();
    if (task && baseline) {
      const edited = editTaskDraft(
        baseline,
        {
          ...current,
          statusId: current.statusId || null,
          dueDate: current.dueDate || null,
          groupId: current.groupId || null,
        },
        taskDraft(task),
        {
          ...patch,
          ...("statusId" in patch ? { statusId: patch.statusId || null } : {}),
          ...("dueDate" in patch ? { dueDate: patch.dueDate || null } : {}),
          ...("groupId" in patch ? { groupId: patch.groupId || null } : {}),
        },
      );
      setBaseline(edited.baseline);
      store.setState({
        ...edited.local,
        statusId: edited.local.statusId ?? "",
        dueDate: edited.local.dueDate ?? "",
        groupId: edited.local.groupId ?? "",
      });
    } else
      store.setState({
        ...patch,
        fieldValues: { ...current.fieldValues, ...patch.fieldValues },
      });
  };
  const changeValue = (fieldId: string, value: FieldValue) =>
    editDraft({ fieldValues: { [fieldId]: value } });
  return (
    <>
      <header className="task-sheet-header">
        {task && (
          <div className="task-sheet-heading-meta">
            <span
              className="task-meta-chip"
              style={optionBadgeStyle(selectedStatus)}
            >
              <StatusIcon icon={selectedStatus?.icon} />
              {selectedStatus?.label ?? "No status"}
            </span>
            <span className="task-reference">
              #{task.id.slice(-6).toUpperCase()}
            </span>
          </div>
        )}
        <SheetTitle className="task-sheet-title">
          {task ? draft.name : "Create task"}
        </SheetTitle>
        {task && (
          <>
            <div className="task-header-tags">
              {state.fields
                .filter((field) => field.type === "TAGS")
                .flatMap((field) => {
                  const value = draft.fieldValues[field.id];
                  return (Array.isArray(value) ? value : []).map((id) => {
                    const option = field.options.find((item) => item.id === id);
                    return (
                      <span
                        className="task-meta-chip"
                        style={optionBadgeStyle(option)}
                        key={`${field.id}-${id}`}
                      >
                        {option?.label ?? id}
                      </span>
                    );
                  });
                })}
            </div>
            <div className="task-sheet-metadata">
              <AssigneeAvatars ids={draft.assigneeIds} people={state.people} />
              {draft.dueDate && (
                <span className="task-meta-chip">
                  <CalendarDays size={14} />
                  {formatDueDate(draft.dueDate, true)}
                </span>
              )}
              <span
                className="task-meta-chip"
                style={optionBadgeStyle(selectedPriority)}
              >
                <Flag size={14} />
                {selectedPriority?.label ?? draft.priority}
              </span>
            </div>
          </>
        )}
      </header>
      <SheetDescription className="task-sheet-description">
        {task?.archivedAt
          ? "Archived task · read-only"
          : editable
            ? "Keep the task, people, and next steps together."
            : "You can view this task. Editing requires creator, assignee, or editor access."}
      </SheetDescription>
      {task && (
        <div
          className="task-sheet-tabs"
          role="tablist"
          aria-label="Task sections"
          onKeyDown={(event) => {
            const keys = ["ArrowRight", "ArrowLeft", "Home", "End"];
            if (!keys.includes(event.key)) return;
            event.preventDefault();
            const tabs = ["details", "comments", "activity", "files"] as const;
            const index = tabs.indexOf(tab);
            const next =
              event.key === "Home"
                ? 0
                : event.key === "End"
                  ? tabs.length - 1
                  : (index +
                      (event.key === "ArrowRight" ? 1 : -1) +
                      tabs.length) %
                    tabs.length;
            setTab(tabs[next]!);
            event.currentTarget
              .querySelectorAll<HTMLButtonElement>('[role="tab"]')
              [next]?.focus();
          }}
        >
          <button
            type="button"
            role="tab"
            id="task-tab-details"
            aria-controls="task-editor-form"
            tabIndex={tab === "details" ? 0 : -1}
            aria-selected={tab === "details"}
            onClick={() => setTab("details")}
          >
            Details
          </button>
          <button
            type="button"
            role="tab"
            id="task-tab-comments"
            aria-controls="task-panel-comments"
            tabIndex={tab === "comments" ? 0 : -1}
            aria-selected={tab === "comments"}
            onClick={() => setTab("comments")}
          >
            Comments <span>{task.commentCount ?? 0}</span>
          </button>
          <button
            type="button"
            role="tab"
            id="task-tab-activity"
            aria-controls="task-panel-activity"
            tabIndex={tab === "activity" ? 0 : -1}
            aria-selected={tab === "activity"}
            onClick={() => setTab("activity")}
          >
            Activity
          </button>
          <button
            type="button"
            role="tab"
            id="task-tab-files"
            aria-controls="task-panel-files"
            tabIndex={tab === "files" ? 0 : -1}
            aria-selected={tab === "files"}
            onClick={() => setTab("files")}
          >
            Files <span>{task.attachmentCount ?? 0}</span>
          </button>
        </div>
      )}
      <div className="task-sheet-body">
        {requiresApproval && (
          <p className="mb-4 rounded-md border border-border bg-muted/40 p-3 text-xs leading-5">
            This request needs one other approver. Current board values stay
            unchanged until it is accepted.
          </p>
        )}
        {task &&
          state.pendingApprovals.some(
            (proposal) => proposal.taskId === task.id,
          ) && (
            <p className="mb-4 text-xs text-muted-foreground">
              This task has a pending request.{" "}
              <Link className="text-primary underline" href="/approvals">
                Open approvals
              </Link>
            </p>
          )}
        {conflicts.length > 0 && (
          <section
            role="status"
            aria-label="Task edit conflict"
            className="mb-4 space-y-3 rounded-md border border-border bg-muted/50 p-3 text-sm"
          >
            <p>
              Someone changed the same fields:{" "}
              {conflicts
                .map(
                  (key) =>
                    fieldLabels[key] ??
                    state.fields.find((field) => `field:${field.id}` === key)
                      ?.name ??
                    "Removed field",
                )
                .join(", ")}
              . Your edits are preserved.
            </p>
            <p className="text-xs text-muted-foreground">
              Use the latest values, or keep your edits to these fields before
              saving.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() => acceptLatest(false)}
              >
                Load latest task
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={pending || !editable}
                onClick={() => acceptLatest(true)}
              >
                Keep my edits
              </Button>
            </div>
          </section>
        )}
        <form
          id="task-editor-form"
          role={task ? "tabpanel" : undefined}
          aria-labelledby={task ? "task-tab-details" : undefined}
          hidden={task && tab !== "details"}
          className="task-sheet-details space-y-5"
          onSubmit={(event) => {
            event.preventDefault();
            if (
              conflicts.length ||
              (task && !Object.keys(merged?.changes ?? {}).length)
            )
              return;
            onSubmit(
              task
                ? {
                    taskId: task.id,
                    revision: task.revision,
                    requestKey: createKey,
                    changes: merged!.changes,
                  }
                : { boardId: state.boardId, createKey, ...submissionChanges() },
            );
          }}
        >
          <fieldset disabled={!editable || pending} className="space-y-5">
            <details className="task-title-edit" open={!task}>
              <summary>{task ? "Rename task" : "Task title"}</summary>
              <label className="task-field-label">
                Task name
                <Input
                  aria-label="Task name"
                  required
                  maxLength={200}
                  value={draft.name}
                  onChange={(event) => editDraft({ name: event.target.value })}
                />
              </label>
            </details>
            <label className="task-field-label">
              <span className="task-section-heading">
                <FileText size={15} /> Description
              </span>
              <textarea
                aria-label="Task description"
                rows={task ? 3 : 4}
                maxLength={10000}
                className="task-textarea"
                value={draft.description}
                onChange={(event) =>
                  editDraft({ description: event.target.value })
                }
              />
            </label>
            <section
              className="task-checklist-section"
              aria-label="Task checklist"
            >
              <h3 className="task-section-heading">
                <ListChecks size={15} />
                Checklist
                {draft.checklist.length > 0 && (
                  <span className="ml-auto">
                    {draft.checklist.filter((item) => item.done).length}/
                    {draft.checklist.length}
                  </span>
                )}
              </h3>
              {draft.checklist.length > 0 && (
                <progress
                  aria-label="Task checklist progress"
                  value={draft.checklist.filter((item) => item.done).length}
                  max={draft.checklist.length}
                />
              )}
              {!draft.checklist.length && (
                <p className="mt-3 text-xs text-muted-foreground">
                  Add steps for this task. An empty checklist stays off the task
                  card.
                </p>
              )}
              <ul className="mt-3 space-y-2">
                {draft.checklist.map((item, index) => (
                  <li key={item.id} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      aria-label={`Complete checklist item ${index + 1}`}
                      checked={item.done}
                      onChange={(event) =>
                        editDraft({
                          checklist: draft.checklist.map((current) =>
                            current.id === item.id
                              ? { ...current, done: event.target.checked }
                              : current,
                          ),
                        })
                      }
                    />
                    <Input
                      aria-label={`Checklist item ${index + 1}`}
                      maxLength={300}
                      required
                      value={item.text}
                      className={
                        item.done ? "text-muted-foreground line-through" : ""
                      }
                      onChange={(event) =>
                        editDraft({
                          checklist: draft.checklist.map((current) =>
                            current.id === item.id
                              ? { ...current, text: event.target.value }
                              : current,
                          ),
                        })
                      }
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove checklist item ${index + 1}`}
                      onClick={() =>
                        editDraft({
                          checklist: draft.checklist.filter(
                            (current) => current.id !== item.id,
                          ),
                        })
                      }
                    >
                      <Trash2 size={14} />
                    </Button>
                  </li>
                ))}
              </ul>
              <div className="mt-3 flex gap-2">
                <Input
                  aria-label="New checklist item"
                  placeholder="Add a step…"
                  maxLength={300}
                  value={newChecklistItem}
                  onChange={(event) => setNewChecklistItem(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      if (
                        newChecklistItem.trim() &&
                        draft.checklist.length < 100
                      ) {
                        editDraft({
                          checklist: [
                            ...draft.checklist,
                            {
                              id: createRecordId(),
                              text: newChecklistItem.trim(),
                              done: false,
                            },
                          ],
                        });
                        setNewChecklistItem("");
                      }
                    }
                  }}
                />
                <Button
                  type="button"
                  size="sm"
                  disabled={
                    !newChecklistItem.trim() || draft.checklist.length >= 100
                  }
                  onClick={() => {
                    editDraft({
                      checklist: [
                        ...draft.checklist,
                        {
                          id: createRecordId(),
                          text: newChecklistItem.trim(),
                          done: false,
                        },
                      ],
                    });
                    setNewChecklistItem("");
                  }}
                >
                  <Plus size={13} />
                  Add step
                </Button>
              </div>
            </section>
            {checklistFields.map((field) => {
              const stored = draft.fieldValues[field.id];
              const values = Array.isArray(stored) ? stored : [];
              return (
                <section key={field.id} className="task-checklist-section">
                  <h3 className="task-section-heading">
                    <ListChecks size={15} />
                    {field.name}
                    <span className="ml-auto">
                      {values.length}/{field.options.length}
                    </span>
                  </h3>
                  <progress
                    value={values.length}
                    max={Math.max(1, field.options.length)}
                    aria-label={`${field.name} progress`}
                  />
                  <div
                    role="group"
                    aria-label={field.name}
                    className="task-checklist-options"
                  >
                    {field.options.map((option) => (
                      <label key={option.id}>
                        <input
                          type="checkbox"
                          checked={values.includes(option.id)}
                          onChange={(event) =>
                            changeValue(
                              field.id,
                              event.target.checked
                                ? [...values, option.id]
                                : values.filter((id) => id !== option.id),
                            )
                          }
                        />
                        {option.label}
                      </label>
                    ))}
                  </div>
                </section>
              );
            })}
            <h3 className="task-section-heading border-t pt-4">
              <SlidersHorizontal size={15} />
              Custom fields
            </h3>
            <div className="grid grid-cols-2 gap-3">
              <label className="task-field-label">
                Status
                <select
                  aria-label="Task status"
                  className="task-select"
                  value={draft.statusId}
                  onChange={(event) =>
                    editDraft({ statusId: event.target.value })
                  }
                >
                  <option value="">No status</option>
                  {statusOptions.map((option) => (
                    <option value={option.id} key={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="task-field-label">
                Priority
                <select
                  aria-label="Task priority"
                  className="task-select"
                  value={draft.priority}
                  onChange={(event) =>
                    editDraft({ priority: event.target.value })
                  }
                >
                  {priorityChoices.map(({ id: priority, label }) => (
                    <option key={priority} value={priority}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="task-field-label">
                Due date
                <Input
                  aria-label="Task due date"
                  type="date"
                  value={draft.dueDate}
                  onChange={(event) =>
                    editDraft({ dueDate: event.target.value })
                  }
                />
              </label>
              <label className="task-field-label">
                Group
                <select
                  aria-label="Task group"
                  className="task-select"
                  value={draft.groupId}
                  onChange={(event) =>
                    editDraft({ groupId: event.target.value })
                  }
                >
                  <option value="">No group</option>
                  {state.groups.map((group) => (
                    <option value={group.id} key={group.id}>
                      {group.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {customFields.map((field) => {
              const value = draft.fieldValues[field.id];
              const label = field.name;
              return (
                <div key={field.id}>
                  <div className="task-field-label">
                    <span>{label}</span>
                    {field.type === "CHECKBOX" ? (
                      <input
                        aria-label={label}
                        type="checkbox"
                        checked={value === true}
                        onChange={(event) =>
                          changeValue(field.id, event.target.checked)
                        }
                      />
                    ) : field.type === "TAGS" ? (
                      <div
                        role="group"
                        aria-label={label}
                        className="flex flex-wrap gap-2 pt-1"
                      >
                        {field.options.map((option) => {
                          const values = Array.isArray(value) ? value : [];
                          const chosen = values.includes(option.id);
                          return (
                            <Button
                              key={option.id}
                              type="button"
                              size="sm"
                              variant="outline"
                              className="rounded-full aria-pressed:border-primary aria-pressed:bg-primary aria-pressed:text-primary-foreground"
                              aria-pressed={chosen}
                              style={
                                chosen
                                  ? optionBadgeStyle(option)
                                  : option.color
                                    ? { borderColor: option.color }
                                    : undefined
                              }
                              onClick={() =>
                                changeValue(
                                  field.id,
                                  chosen
                                    ? values.filter((id) => id !== option.id)
                                    : [...values, option.id],
                                )
                              }
                            >
                              {option.label}
                            </Button>
                          );
                        })}
                      </div>
                    ) : field.type === "PEOPLE" ? (
                      <select
                        aria-label={label}
                        multiple
                        className="task-select min-h-20"
                        value={Array.isArray(value) ? value : []}
                        onChange={(event) =>
                          changeValue(
                            field.id,
                            Array.from(
                              event.target.selectedOptions,
                              (option) => option.value,
                            ),
                          )
                        }
                      >
                        {(field.type === "PEOPLE"
                          ? state.people.map((person) => ({
                              id: person.id,
                              label: person.name,
                            }))
                          : field.options
                        ).map((option) => (
                          <option key={option.id} value={option.id}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    ) : ["STATUS", "SINGLE_SELECT"].includes(field.type) ? (
                      <select
                        aria-label={label}
                        className="task-select"
                        value={typeof value === "string" ? value : ""}
                        onChange={(event) =>
                          changeValue(field.id, event.target.value || null)
                        }
                      >
                        <option value="">None</option>
                        {field.options.map((option) => (
                          <option key={option.id} value={option.id}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    ) : field.type === "LONG_TEXT" ? (
                      <textarea
                        aria-label={label}
                        className="task-textarea"
                        rows={3}
                        value={typeof value === "string" ? value : ""}
                        onChange={(event) =>
                          changeValue(field.id, event.target.value || null)
                        }
                      />
                    ) : (
                      <Input
                        aria-label={label}
                        type={
                          field.type === "NUMBER"
                            ? "number"
                            : field.type === "DATE"
                              ? "date"
                              : field.type === "EMAIL"
                                ? "email"
                                : field.type === "URL"
                                  ? "url"
                                  : "text"
                        }
                        step={field.type === "NUMBER" ? "any" : undefined}
                        value={
                          typeof value === "string" || typeof value === "number"
                            ? value
                            : ""
                        }
                        onChange={(event) =>
                          changeValue(
                            field.id,
                            !event.target.value
                              ? null
                              : field.type === "NUMBER"
                                ? Number(event.target.value)
                                : event.target.value,
                          )
                        }
                      />
                    )}
                  </div>
                </div>
              );
            })}
            <section className="border-t pt-4">
              <h3 className="task-section-heading mb-3">
                <Users size={15} />
                Assignees
              </h3>
              <div>
                <div className="task-people-options">
                  {state.people.map((person) => (
                    <label key={person.id}>
                      <input
                        type="checkbox"
                        aria-label={`Assign ${person.name}`}
                        checked={draft.assigneeIds.includes(person.id)}
                        onChange={(event) =>
                          editDraft({
                            assigneeIds: event.target.checked
                              ? [...draft.assigneeIds, person.id]
                              : draft.assigneeIds.filter(
                                  (id) => id !== person.id,
                                ),
                          })
                        }
                      />
                      <AssigneeAvatars
                        ids={[person.id]}
                        people={state.people}
                      />
                      {person.name}
                    </label>
                  ))}
                </div>
              </div>
            </section>
          </fieldset>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </form>
        {task && (
          <>
            <div
              id="task-panel-comments"
              role="tabpanel"
              aria-labelledby="task-tab-comments"
              hidden={tab !== "comments"}
            >
              <TaskComments
                state={state}
                task={task}
                active={tab === "comments"}
                syncInterval={syncInterval}
                onNotice={onNotice}
              />
            </div>
            <section
              id="task-panel-activity"
              role="tabpanel"
              aria-labelledby="task-tab-activity"
              hidden={tab !== "activity"}
              className="task-sheet-activity"
            >
              <h3 className="task-section-heading">
                <History size={15} />
                Activity
              </h3>
              <p className="mt-2 text-xs text-muted-foreground">
                Created by {task.createdByName} · revision {task.revision}
              </p>
              <ul className="task-activity">
                {task.activity.map((event) => (
                  <li key={event.id}>
                    <b>{event.action}</b>
                    <span>
                      {event.actor} ·{" "}
                      {new Date(event.createdAt)
                        .toISOString()
                        .slice(0, 16)
                        .replace("T", " ")}{" "}
                      UTC
                    </span>
                  </li>
                ))}
              </ul>
            </section>
            <section
              id="task-panel-files"
              role="tabpanel"
              aria-labelledby="task-tab-files"
              hidden={tab !== "files"}
            >
              <TaskFiles
                state={state}
                task={task}
                active={tab === "files"}
                syncInterval={syncInterval}
                onNotice={onNotice}
              />
            </section>
            {state.canManage && !task.archivedAt && (
              <section
                hidden={tab !== "details"}
                className="task-sheet-permissions border-t pt-5"
              >
                <h3 className="mb-3 text-sm">Task editors</h3>
                <p className="mb-3 text-xs text-muted-foreground">
                  Creators and current assignees can already edit this task.
                </p>
                {task.editorIds.map((id) => (
                  <div
                    key={id}
                    className="mb-2 flex items-center justify-between text-xs"
                  >
                    <span>
                      {state.people.find((person) => person.id === id)?.name ??
                        "Former member"}
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={pending}
                      onClick={() =>
                        onAction("editor", {
                          taskId: task.id,
                          revision: task.revision,
                          userId: id,
                          grant: false,
                        })
                      }
                    >
                      Remove editor
                    </Button>
                  </div>
                ))}
                <div className="flex gap-2">
                  <select
                    aria-label="Grant task editor"
                    className="task-select min-w-0 flex-1"
                    value={accessPerson}
                    onChange={(event) => setAccessPerson(event.target.value)}
                  >
                    <option value="">Choose a person</option>
                    {state.people
                      .filter((person) => !task.editorIds.includes(person.id))
                      .map((person) => (
                        <option key={person.id} value={person.id}>
                          {person.name}
                        </option>
                      ))}
                  </select>
                  <Button
                    size="sm"
                    disabled={!accessPerson || pending}
                    onClick={() =>
                      onAction("editor", {
                        taskId: task.id,
                        revision: task.revision,
                        userId: accessPerson,
                        grant: true,
                      })
                    }
                  >
                    Grant editor
                  </Button>
                </div>
              </section>
            )}
          </>
        )}
      </div>
      <footer className="task-sheet-footer">
        {editable && tab === "details" && (
          <Button
            form="task-editor-form"
            type="submit"
            disabled={
              pending ||
              conflicts.length > 0 ||
              Boolean(task && !Object.keys(merged?.changes ?? {}).length)
            }
            className="flex-1"
          >
            {pending
              ? "Saving…"
              : requiresApproval
                ? task
                  ? "Request approval"
                  : "Submit task for approval"
                : task
                  ? "Save changes"
                  : "Create task"}
          </Button>
        )}
        {task?.canEdit &&
          tab === "details" &&
          statusOptions.some((option) => option.id === "done") &&
          draft.statusId !== "done" && (
            <Button
              disabled={pending || conflicts.length > 0}
              variant="outline"
              onClick={() =>
                onSubmit({
                  taskId: task.id,
                  revision: task.revision,
                  requestKey: createKey,
                  changes: { ...merged?.changes, statusId: "done" },
                })
              }
            >
              <Check size={14} />
              {completionRequiresApproval
                ? "Request completion"
                : "Mark as done"}
            </Button>
          )}
        {task && (
          <>
            {" "}
            {(task.canEdit || (task.archivedAt && state.canManage)) && (
              <Button
                variant="outline"
                size={task.archivedAt ? "default" : "icon"}
                title={task.archivedAt ? "Restore task" : "Archive task"}
                aria-label={task.archivedAt ? "Restore task" : "Archive task"}
                disabled={pending}
                onClick={() =>
                  onAction(task.archivedAt ? "restore" : "archive", {
                    taskId: task.id,
                    revision: task.revision,
                  })
                }
              >
                {task.archivedAt ? "Restore task" : <Archive size={15} />}
              </Button>
            )}
          </>
        )}
      </footer>
    </>
  );
}
