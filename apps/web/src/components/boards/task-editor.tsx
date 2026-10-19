"use client";
import { PauseAlert } from "@/components/pause/pause-alert";
import { useState } from "react";
import { createRecordId } from "@yuzu/database/ids";
import { needsApproval } from "@/lib/approval-rules";
import Link from "next/link";
import { taskDraft, reconcileTaskDraft, editTaskDraft } from "@/lib/task-sync";
import { createStore } from "zustand/vanilla";
import { useStore } from "zustand";
import {
  Archive,
  ArchiveRestore,
  ArrowRight,
  ChevronDown,
  Ellipsis,
  Hourglass,
  Link2,
  ListChecks,
  Lock,
  FileText,
  Check,
  History,
  Plus,
  Trash2,
  UserCog,
} from "lucide-react";
import { TaskComments } from "./task-comments";
import { TaskFiles } from "./task-files";
import type { TaskUploads } from "./use-task-uploads";
import type { TransferNoticeHandler } from "@/components/ui/yuzu-toast";
import {
  AssigneeAvatars,
  StatusIcon,
  optionBadgeStyle,
  PersonAvatar,
  formatDueDate,
  priorityOptions,
} from "./board-presentation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SheetTitle, SheetDescription } from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  PauseButton,
  PauseClose,
  PauseModal,
} from "@/components/pause/pause-dialog";
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
  boardName,
  onNotice,
  onTransferNotice,
  uploads,
  syncInterval = 15_000,
  defaultDueDate,
  defaultStatusId,
}: {
  state: BoardState;
  task?: BoardTask;
  /** Prefills the due date of a new task, such as a calendar day. */
  defaultDueDate?: string;
  /** Prefills the status of a new task, such as the lane it was added from. */
  defaultStatusId?: string;
  pending: boolean;
  syncInterval?: number;
  error?: string;
  onSubmit: (input: unknown) => void;
  onAction: (action: string, input: unknown) => void;
  /** Shown in the panel's breadcrumb. */
  boardName?: string;
  onNotice: (message: string, kind: "success" | "error") => void;
  onTransferNotice: TransferNoticeHandler;
  uploads: TaskUploads;
}) {
  const [store] = useState(() =>
    createStore(() => ({
      name: task?.name ?? "",
      description: task?.description ?? "",
      checklist: task?.checklist ?? [],
      statusId: task
        ? (task.statusId ?? "")
        : (defaultStatusId ??
          state.fields.find((field) => field.key === "status")?.options[0]
            ?.id ??
          ""),
      priority: task?.priority ?? "NORMAL",
      startDate: task?.startDate ?? "",
      dueDate: task?.dueDate ?? defaultDueDate ?? "",
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
            startDate: localDraft.startDate || null,
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
        startDate: merged.draft.startDate ?? "",
        dueDate: merged.draft.dueDate ?? "",
        groupId: merged.draft.groupId ?? "",
      }
    : localDraft;
  const conflicts = merged?.conflicts ?? [];
  const dateOrderInvalid = Boolean(
    draft.startDate && draft.dueDate && draft.startDate > draft.dueDate,
  );
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
    startDate: "Start date",
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
      startDate: next.startDate ?? "",
      dueDate: next.dueDate ?? "",
      groupId: next.groupId ?? "",
    });
  };
  const [createKey, setCreateKey] = useState(() => crypto.randomUUID());
  const [tab, setTab] = useState<"comments" | "activity" | "files">("comments");
  const [composerSlot, setComposerSlot] = useState<HTMLDivElement | null>(null);
  const [editorsOpen, setEditorsOpen] = useState(false);
  const [accessPerson, setAccessPerson] = useState("");
  const [newChecklistItem, setNewChecklistItem] = useState("");
  const editable = !task || task.canEdit;
  const currentGroup = state.groups.find((group) => group.id === draft.groupId);
  const pendingRequest = task
    ? state.pendingApprovals.find((proposal) => proposal.taskId === task.id)
    : undefined;
  const canManageEditors = Boolean(task && state.canManage && !task.archivedAt);
  const showSave =
    editable &&
    (!task ||
      conflicts.length > 0 ||
      Object.keys(merged?.changes ?? {}).length > 0);
  const statusOptions =
    state.fields.find((field) => field.key === "status")?.options ?? [];
  const canComplete = Boolean(
    task?.canEdit &&
    statusOptions.some((option) => option.id === "done") &&
    draft.statusId !== "done",
  );
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
    startDate: draft.startDate || null,
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
          startDate: current.startDate || null,
          dueDate: current.dueDate || null,
          groupId: current.groupId || null,
        },
        taskDraft(task),
        {
          ...patch,
          ...("statusId" in patch ? { statusId: patch.statusId || null } : {}),
          ...("startDate" in patch
            ? { startDate: patch.startDate || null }
            : {}),
          ...("dueDate" in patch ? { dueDate: patch.dueDate || null } : {}),
          ...("groupId" in patch ? { groupId: patch.groupId || null } : {}),
        },
      );
      setBaseline(edited.baseline);
      store.setState({
        ...edited.local,
        statusId: edited.local.statusId ?? "",
        startDate: edited.local.startDate ?? "",
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
        <div className="task-panel-crumbs">
          <span className="task-panel-board">
            <span className="task-panel-board-dot" aria-hidden="true" />
            {boardName ?? "Board"}
          </span>
          {currentGroup && (
            <span className="task-panel-group">{currentGroup.name}</span>
          )}
          {task && (
            <div className="task-panel-actions">
              <button
                type="button"
                className="task-panel-icon"
                aria-label="Copy task link"
                title="Copy task link"
                onClick={() => {
                  const url = new URL(window.location.href);
                  url.searchParams.set("task", task.id);
                  url.searchParams.delete("tab");
                  navigator.clipboard
                    ?.writeText(url.toString())
                    .then(() => onNotice("Task link copied.", "success"))
                    .catch(() =>
                      onNotice("Couldn't copy the task link.", "error"),
                    );
                }}
              >
                <Link2 size={16} />
              </button>
              {(task.canEdit || (task.archivedAt && state.canManage)) && (
                <button
                  type="button"
                  className="task-panel-icon"
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
                  {task.archivedAt ? (
                    <ArchiveRestore size={16} />
                  ) : (
                    <Archive size={16} />
                  )}
                </button>
              )}
              {(canComplete || canManageEditors) && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className="task-panel-icon"
                      aria-label="More task actions"
                      title="More task actions"
                    >
                      <Ellipsis size={16} />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {canComplete && (
                      <DropdownMenuItem
                        disabled={
                          pending || conflicts.length > 0 || dateOrderInvalid
                        }
                        onSelect={() =>
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
                      </DropdownMenuItem>
                    )}
                    {canManageEditors && (
                      <DropdownMenuItem onSelect={() => setEditorsOpen(true)}>
                        <UserCog size={14} />
                        Task editors…
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          )}
        </div>
        <div className="task-sheet-heading-meta">
          <label
            className="task-status-pill"
            style={optionBadgeStyle(selectedStatus)}
          >
            <StatusIcon icon={selectedStatus?.icon} />
            <select
              aria-label="Task status"
              form="task-editor-form"
              disabled={!editable || pending}
              value={draft.statusId}
              onChange={(event) => editDraft({ statusId: event.target.value })}
            >
              <option value="">No status</option>
              {statusOptions.map((option) => (
                <option value={option.id} key={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
            <ChevronDown size={14} aria-hidden="true" />
          </label>
          {task && (
            <span className="task-reference">
              #{task.id.slice(-6).toUpperCase()}
            </span>
          )}
        </div>
        <SheetTitle className="sr-only">
          {task ? draft.name : "Create task"}
        </SheetTitle>
        <textarea
          aria-label="Task name"
          form="task-editor-form"
          className="task-title-input"
          placeholder="Name this task"
          required
          rows={1}
          maxLength={200}
          disabled={!editable || pending}
          autoFocus={!task}
          value={draft.name}
          onChange={(event) =>
            editDraft({ name: event.target.value.replace(/\n/g, " ") })
          }
          onKeyDown={(event) => {
            if (event.key === "Enter") event.preventDefault();
          }}
        />
        <SheetDescription className="task-sheet-description">
          {task && (
            <PersonAvatar
              name={task.createdByName}
              image={
                state.people.find((person) => person.id === task.createdById)
                  ?.image
              }
            />
          )}
          {task?.archivedAt
            ? "Archived task · read-only"
            : task
              ? `Created by ${task.createdByName}${editable ? "" : " · view only. Editing requires creator, assignee, or editor access."}`
              : "Click any property to set it."}
        </SheetDescription>
      </header>
      <div className="task-sheet-body">
        {task && pendingRequest && (
          <section className="task-approval-card" aria-label="Pending request">
            <p className="task-approval-tape">
              <Hourglass size={15} aria-hidden="true" />
              {pendingRequest.operation === "ARCHIVE"
                ? "Archiving waits for approval"
                : "A change to this task is waiting for approval"}
            </p>
            <div className="task-approval-meta">
              <AssigneeAvatars
                ids={[pendingRequest.authorId]}
                people={state.people}
              />
              <span>
                {pendingRequest.authorName} sent it{" "}
                {formatSent(pendingRequest.createdAt)}
              </span>
              <Link href="/approvals">Open request</Link>
            </div>
          </section>
        )}
        {conflicts.length > 0 && (
          <PauseAlert
            intent="warning"
            role="status"
            label="Task edit conflict"
            className="task-conflict-alert"
            title="Someone changed the same fields"
            action={
              <span className="flex flex-wrap gap-4">
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => acceptLatest(false)}
                >
                  Load latest task
                </button>
                <button
                  type="button"
                  disabled={pending || !editable}
                  onClick={() => acceptLatest(true)}
                >
                  Keep my edits
                </button>
              </span>
            }
          >
            <p>
              {conflicts
                .map(
                  (key) =>
                    fieldLabels[key] ??
                    state.fields.find((field) => `field:${field.id}` === key)
                      ?.name ??
                    "Removed field",
                )
                .join(", ")}
              . Your edits are kept: load the latest task, or keep your edits to
              these fields before saving.
            </p>
          </PauseAlert>
        )}
        <form
          id="task-editor-form"
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
            <div
              className="task-props"
              role="group"
              aria-label="Task properties"
            >
              <div className="task-prop">
                <span className="task-prop-label">Assignees</span>
                <details className="task-prop-value task-prop-people">
                  <summary>
                    {draft.assigneeIds.length ? (
                      <>
                        <AssigneeAvatars
                          ids={draft.assigneeIds}
                          people={state.people}
                        />
                        <span className="truncate">
                          {draft.assigneeIds
                            .map(
                              (id) =>
                                state.people
                                  .find((person) => person.id === id)
                                  ?.name.split(" ")[0] ?? "Former member",
                            )
                            .join(", ")}
                        </span>
                      </>
                    ) : (
                      <span className="task-prop-empty">Add people</span>
                    )}
                  </summary>
                  <div className="task-people-options">
                    {state.people
                      .filter(
                        (person) =>
                          !person.deactivated ||
                          draft.assigneeIds.includes(person.id),
                      )
                      .map((person) => (
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
                </details>
              </div>
              <div className="task-prop">
                <span className="task-prop-label">Dates</span>
                <div className="task-prop-value task-prop-dates">
                  <DateChip
                    label="Task start date"
                    empty="Start"
                    value={draft.startDate}
                    max={draft.dueDate || undefined}
                    invalid={dateOrderInvalid}
                    describedBy={
                      dateOrderInvalid ? "task-date-order" : undefined
                    }
                    onChange={(startDate) => editDraft({ startDate })}
                  />
                  <ArrowRight size={14} aria-hidden="true" />
                  <DateChip
                    label="Task due date"
                    empty="Due"
                    value={draft.dueDate}
                    min={draft.startDate || undefined}
                    onChange={(dueDate) => editDraft({ dueDate })}
                  />
                </div>
              </div>
              {dateOrderInvalid && (
                <p
                  id="task-date-order"
                  role="alert"
                  className="text-sm text-destructive"
                >
                  The start date must be on or before the due date.
                </p>
              )}
              <div className="task-prop">
                <span className="task-prop-label">Priority</span>
                <label className="task-prop-value">
                  <span
                    className="task-prop-dot"
                    style={{ background: selectedPriority?.color ?? undefined }}
                    aria-hidden="true"
                  />
                  <select
                    aria-label="Task priority"
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
              </div>
              <div className="task-prop">
                <span className="task-prop-label">Group</span>
                <label className="task-prop-value">
                  <select
                    aria-label="Task group"
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
                  <div key={field.id} className="task-prop">
                    <span className="task-prop-label">{label}</span>
                    <div className="task-prop-value">
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
                            ? state.people
                                .filter((person) => !person.deactivated)
                                .map((person) => ({
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
                            typeof value === "string" ||
                            typeof value === "number"
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
            </div>
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
              className="task-sheet-tabs"
              role="tablist"
              aria-label="Task conversation"
              onKeyDown={(event) => {
                const keys = ["ArrowRight", "ArrowLeft", "Home", "End"];
                if (!keys.includes(event.key)) return;
                event.preventDefault();
                const tabs = ["comments", "activity", "files"] as const;
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
                composerTarget={composerSlot}
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
                uploads={uploads}
                onTransferNotice={onTransferNotice}
                state={state}
                task={task}
                active={tab === "files"}
                syncInterval={syncInterval}
                onNotice={onNotice}
              />
            </section>
          </>
        )}
      </div>
      {task && canManageEditors && (
        <PauseModal
          open={editorsOpen}
          onOpenChange={setEditorsOpen}
          title="Task editors"
          description="Creators and current assignees can already edit this task."
          actions={
            <PauseClose asChild>
              <PauseButton>Done</PauseButton>
            </PauseClose>
          }
        >
          <div className="grid gap-2">
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
                  .filter(
                    (person) =>
                      !person.deactivated &&
                      !task.editorIds.includes(person.id),
                  )
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
          </div>
        </PauseModal>
      )}
      <footer className="task-sheet-footer">
        {showSave && (
          <div className="task-save-bar">
            <span className="task-save-note">
              {requiresApproval ? (
                <>
                  <Lock size={13} aria-hidden="true" />
                  Needs approval
                </>
              ) : task ? (
                "Unsaved changes"
              ) : null}
            </span>
            {task && (
              <Button
                type="button"
                variant="ghost"
                disabled={pending}
                onClick={() => acceptLatest(false)}
              >
                Discard
              </Button>
            )}
            <Button
              form="task-editor-form"
              type="submit"
              disabled={
                pending ||
                conflicts.length > 0 ||
                dateOrderInvalid ||
                Boolean(task && !Object.keys(merged?.changes ?? {}).length)
              }
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
          </div>
        )}
        {task && (
          <div
            ref={setComposerSlot}
            className="task-composer-slot"
            hidden={tab !== "comments" || Boolean(task.archivedAt)}
          />
        )}
      </footer>
    </>
  );
}

/** A date that reads as "Oct 19, 2026" and opens the native picker. */
function DateChip({
  label,
  empty,
  value,
  min,
  max,
  invalid,
  describedBy,
  onChange,
}: {
  label: string;
  empty: string;
  value: string;
  min?: string;
  max?: string;
  invalid?: boolean;
  describedBy?: string;
  onChange: (value: string) => void;
}) {
  return (
    <span className="task-date-chip" data-empty={!value || undefined}>
      {value ? formatDueDate(value, true) : empty}
      <input
        aria-label={label}
        type="date"
        value={value}
        min={min}
        max={max}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        onClick={(event) => {
          try {
            event.currentTarget.showPicker();
          } catch {
            // Older browsers keep the default date input behavior.
          }
        }}
        onChange={(event) => onChange(event.target.value)}
      />
    </span>
  );
}

function formatSent(value: string) {
  const minutes = Math.round((Date.now() - new Date(value).getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)}h ago`;
  return `on ${new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(new Date(value))}`;
}
