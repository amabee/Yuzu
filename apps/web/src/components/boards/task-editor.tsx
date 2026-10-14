"use client";
import { useState } from "react";
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
} from "lucide-react";
import { TaskComments } from "./task-comments";
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
}: {
  state: BoardState;
  task?: BoardTask;
  pending: boolean;
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
  const draft = useStore(store);
  const [createKey] = useState(() => crypto.randomUUID());
  const [revision] = useState(task?.revision);
  const [tab, setTab] = useState<"details" | "comments" | "activity">(
    task ? initialTab : "details",
  );
  const [accessPerson, setAccessPerson] = useState("");
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
  const changeValue = (fieldId: string, value: FieldValue) =>
    store.setState({
      fieldValues: { ...store.getState().fieldValues, [fieldId]: value },
    });
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
            const tabs = ["details", "comments", "activity"] as const;
            const index = tabs.indexOf(tab);
            const next =
              event.key === "Home"
                ? 0
                : event.key === "End"
                  ? 2
                  : (index + (event.key === "ArrowRight" ? 1 : -1) + 3) % 3;
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
        </div>
      )}
      <div className="task-sheet-body">
        <form
          id="task-editor-form"
          role={task ? "tabpanel" : undefined}
          aria-labelledby={task ? "task-tab-details" : undefined}
          hidden={task && tab !== "details"}
          className="task-sheet-details space-y-5"
          onSubmit={(event) => {
            event.preventDefault();
            const changes = submissionChanges();
            onSubmit(
              task
                ? { taskId: task.id, revision, changes }
                : { boardId: state.boardId, createKey, ...changes },
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
                  onChange={(event) =>
                    store.setState({ name: event.target.value })
                  }
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
                  store.setState({ description: event.target.value })
                }
              />
            </label>
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
                    store.setState({ statusId: event.target.value })
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
                    store.setState({ priority: event.target.value })
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
                    store.setState({ dueDate: event.target.value })
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
                    store.setState({ groupId: event.target.value })
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
                          store.setState({
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
            disabled={pending}
            className="flex-1"
          >
            {pending ? "Saving…" : task ? "Save changes" : "Create task"}
          </Button>
        )}
        {task?.canEdit &&
          tab === "details" &&
          statusOptions.some((option) => option.id === "done") &&
          draft.statusId !== "done" && (
            <Button
              disabled={pending}
              variant="outline"
              onClick={() =>
                onSubmit({
                  taskId: task.id,
                  revision,
                  changes: { ...submissionChanges(), statusId: "done" },
                })
              }
            >
              <Check size={14} />
              Mark as done
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
