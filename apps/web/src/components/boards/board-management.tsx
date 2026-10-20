"use client";
import { BoardRecordSettings } from "./record-settings";
import type { NumberFormat } from "@/lib/record-types";
import { useState } from "react";
import { ApprovalPolicyEditor } from "./approval-policy-editor";
import { Button } from "@/components/ui/button";
import { ArrowUp, ArrowDown, GripVertical, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  fieldTypes,
  coreKeys,
  statusIcons,
  priorities,
  recordOf,
  type BoardState,
  type BoardField,
  visibleFields,
} from "@/lib/board-contract";

function FieldConfiguration({
  field,
  state,
  pending,
  onAction,
}: {
  field: BoardField;
  state: BoardState;
  pending: boolean;
  onAction: (action: string, input: unknown) => void;
}) {
  const [name, setName] = useState(field.name);
  const [options, setOptions] = useState<BoardField["options"]>(
    field.key === "priority" && !field.options.length
      ? priorities.map((id) => ({
          id,
          label: id.charAt(0) + id.slice(1).toLowerCase(),
        }))
      : field.options,
  );
  const [draggedOption, setDraggedOption] = useState<string | null>(null);
  const [format, setFormat] = useState<NumberFormat>(
    field.number?.format ?? "plain",
  );
  const moveOption = (from: number, to: number) => {
    setOptions((current) => {
      const next = [...current];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  };
  const selected = [
    "STATUS",
    "SINGLE_SELECT",
    "MULTI_SELECT",
    "TAGS",
    "PRIORITY",
  ].includes(field.type);
  return (
    <details className="rounded-lg border p-3">
      <summary className="cursor-pointer text-xs">
        {field.name} · {field.type.toLowerCase().replaceAll("_", " ")}
      </summary>
      <form
        className="mt-3 space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          onAction("configure-field", {
            boardId: state.boardId,
            fieldId: field.id,
            version: field.version,
            name,
            options,
            ...(field.type === "NUMBER"
              ? {
                  number: {
                    format,
                    ...(field.number?.decimals !== undefined
                      ? { decimals: field.number.decimals }
                      : {}),
                  },
                }
              : {}),
          });
        }}
      >
        <fieldset disabled={pending} className="space-y-3">
          {field.type === "NUMBER" && (
            <NumberFormatPick
              label={`${field.name} format`}
              value={format}
              locked={Boolean(field.number?.system)}
              currency={state.currency}
              onChange={setFormat}
            />
          )}
          <Input
            aria-label={`Rename ${field.name} field`}
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          {selected && (
            <>
              <p className="text-xs text-muted-foreground">
                Drag the dots or use the arrows to reorder options, then save.
                Status lanes follow this order.
              </p>
              {options.map((option, index) => (
                <div
                  key={option.id}
                  className="flex flex-wrap items-center gap-1"
                  data-option-id={option.id}
                  onDragOver={(event) => {
                    if (draggedOption && !pending) event.preventDefault();
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    const from = options.findIndex(
                      (item) => item.id === draggedOption,
                    );
                    if (!pending && from >= 0 && from !== index)
                      moveOption(from, index);
                    setDraggedOption(null);
                  }}
                >
                  <button
                    type="button"
                    className="task-drag-handle shrink-0"
                    draggable={!pending}
                    aria-label={`Drag ${option.label} option`}
                    onDragStart={(event) => {
                      event.dataTransfer.setData("text/plain", option.id);
                      setDraggedOption(option.id);
                    }}
                    onDragEnd={() => setDraggedOption(null)}
                  >
                    <GripVertical size={14} />
                  </button>
                  <div className="flex flex-col shrink-0">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-6"
                      disabled={index === 0 || pending}
                      aria-label={`Move ${option.label} option up`}
                      onClick={() => moveOption(index, index - 1)}
                    >
                      <ArrowUp size={12} />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-6"
                      disabled={index === options.length - 1 || pending}
                      aria-label={`Move ${option.label} option down`}
                      onClick={() => moveOption(index, index + 1)}
                    >
                      <ArrowDown size={12} />
                    </Button>
                  </div>
                  <Input
                    className="min-w-0 flex-1"
                    aria-label={`Option ${option.label}`}
                    required
                    maxLength={80}
                    value={option.label}
                    onChange={(event) =>
                      setOptions(
                        options.map((current) =>
                          current.id === option.id
                            ? { ...current, label: event.target.value }
                            : current,
                        ),
                      )
                    }
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={field.key === "priority"}
                    aria-label={`Remove ${option.label} option`}
                    onClick={() =>
                      setOptions(
                        options.filter((current) => current.id !== option.id),
                      )
                    }
                  >
                    Remove
                  </Button>
                  {["STATUS", "TAGS", "PRIORITY"].includes(field.type) && (
                    <div className="option-appearance-controls">
                      <label>
                        <span>Color</span>
                        <input
                          type="color"
                          aria-label={`${field.name} ${option.label} color`}
                          value={option.color ?? "#64748b"}
                          onChange={(event) =>
                            setOptions(
                              options.map((item) =>
                                item.id === option.id
                                  ? { ...item, color: event.target.value }
                                  : item,
                              ),
                            )
                          }
                        />
                      </label>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        aria-label={`${field.name} ${option.label} theme color`}
                        aria-pressed={!option.color}
                        onClick={() =>
                          setOptions(
                            options.map((item) =>
                              item.id === option.id
                                ? { ...item, color: undefined }
                                : item,
                            ),
                          )
                        }
                      >
                        Theme
                      </Button>
                      {field.type === "STATUS" && (
                        <select
                          aria-label={`${field.name} ${option.label} icon`}
                          className="task-select"
                          value={option.icon ?? "circle"}
                          onChange={(event) =>
                            setOptions(
                              options.map((item) =>
                                item.id === option.id
                                  ? {
                                      ...item,
                                      icon: event.target
                                        .value as (typeof statusIcons)[number],
                                    }
                                  : item,
                              ),
                            )
                          }
                        >
                          {statusIcons.map((icon) => (
                            <option key={icon} value={icon}>
                              {icon.replaceAll("-", " ")}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  )}
                </div>
              ))}
              {!options.length && !coreKeys.includes(field.key) && (
                <p className="text-xs text-muted-foreground">
                  No options. Saving clears unused options. To hide this field
                  and retain its saved values, use Remove field.
                </p>
              )}
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={field.key === "priority"}
                onClick={() =>
                  setOptions([
                    ...options,
                    { id: crypto.randomUUID(), label: "New option" },
                  ])
                }
              >
                Add option
              </Button>
            </>
          )}
          <div className="flex flex-wrap gap-2">
            <Button size="sm">Save field</Button>
            {!coreKeys.includes(field.key) && (
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={() =>
                  onAction("remove-field", {
                    boardId: state.boardId,
                    fieldId: field.id,
                    version: field.version,
                  })
                }
              >
                Remove field
              </Button>
            )}
          </div>
          {!coreKeys.includes(field.key) && (
            <p className="text-xs text-muted-foreground">
              Removing hides this field from the board. Its saved values are
              retained.
            </p>
          )}
        </fieldset>
      </form>
    </details>
  );
}
function GroupConfiguration({
  state,
  group,
  pending,
  onAction,
}: {
  state: BoardState;
  group: { id: string; name: string };
  pending: boolean;
  onAction: (action: string, input: unknown) => void;
}) {
  const [name, setName] = useState(group.name);
  const [confirm, setConfirm] = useState(false);
  const usage =
    state.groupTaskCounts?.[group.id] ??
    state.tasks.filter((task) => task.groupId === group.id).length;
  return (
    <div className="space-y-2 rounded-lg border p-3" data-group-id={group.id}>
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          onAction("rename-group", {
            boardId: state.boardId,
            groupId: group.id,
            expectedName: group.name,
            name,
          });
        }}
      >
        <Input
          aria-label={`Rename ${group.name} group`}
          required
          maxLength={80}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <Button size="sm" disabled={pending}>
          Rename group
        </Button>
      </form>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          {usage
            ? `${usage} task${usage === 1 ? " uses" : "s use"} this group, including archived tasks. Move them before removing it.`
            : "No tasks use this group. Pending requests are also checked before removal."}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={pending || usage > 0}
          onClick={() => setConfirm(true)}
          aria-label={`Remove ${group.name} group`}
        >
          <Trash2 size={13} />
          Remove group
        </Button>
      </div>
      {confirm && !usage && (
        <div className="rounded-lg border p-3">
          <p className="text-sm">
            Remove {group.name}? Tasks and pending approval requests must not
            use it.
          </p>
          <div className="mt-3 flex gap-2">
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={pending}
              onClick={() =>
                onAction("remove-group", {
                  boardId: state.boardId,
                  groupId: group.id,
                  expectedName: group.name,
                })
              }
            >
              Confirm group removal
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() => setConfirm(false)}
            >
              Keep group
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
export function BoardManagement({
  state,
  pending,
  onAction,
}: {
  state: BoardState;
  pending: boolean;
  onAction: (action: string, input: unknown) => void;
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState<string>("TEXT");
  const [options, setOptions] = useState("");
  const [newFormat, setNewFormat] = useState<NumberFormat>("plain");
  const [group, setGroup] = useState("");
  const [manager, setManager] = useState("");
  return (
    <section className="space-y-4 border-t pt-5">
      <BoardRecordSettings
        key={JSON.stringify(state.record ?? null)}
        state={state}
        pending={pending}
        onAction={onAction}
      />
      <ApprovalPolicyEditor
        key={state.approvalPolicy.version}
        state={state}
        pending={pending}
        onAction={onAction}
      />
      <h3>Manage board structure</h3>
      {state.groups.map((group) => (
        <GroupConfiguration
          key={`${group.id}-${group.name}`}
          state={state}
          group={group}
          pending={pending}
          onAction={onAction}
        />
      ))}
      {state.canManageManagers && (
        <div className="space-y-3">
          <h4 className="text-xs font-semibold">Board managers</h4>
          {state.managerIds.map((id) => (
            <div key={id} className="flex items-center justify-between text-xs">
              <span>
                {state.people.find((person) => person.id === id)?.name ??
                  "Former member"}
              </span>
              <Button
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={() =>
                  onAction("manager", {
                    boardId: state.boardId,
                    userId: id,
                    grant: false,
                  })
                }
              >
                Remove manager
              </Button>
            </div>
          ))}
          <div className="flex gap-2">
            <select
              aria-label="New board manager"
              className="task-select min-w-0 flex-1"
              value={manager}
              onChange={(event) => setManager(event.target.value)}
            >
              <option value="">Choose a person</option>
              {state.people
                .filter(
                  (person) =>
                    !person.deactivated &&
                    !state.managerIds.includes(person.id),
                )
                .map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.name}
                  </option>
                ))}
            </select>
            <Button
              size="sm"
              disabled={pending || !manager}
              onClick={() =>
                onAction("manager", {
                  boardId: state.boardId,
                  userId: manager,
                  grant: true,
                })
              }
            >
              Grant manager
            </Button>
          </div>
        </div>
      )}
      {visibleFields(state).map((field) => (
        <FieldConfiguration
          key={`${field.id}-${field.version}`}
          field={field}
          state={state}
          pending={pending}
          onAction={onAction}
        />
      ))}
      <form
        className="space-y-3 scroll-mt-4 rounded-lg border p-3"
        onSubmit={(event) => {
          event.preventDefault();
          onAction("field", {
            boardId: state.boardId,
            name,
            type,
            options: options
              .split(",")
              .map((item) => item.trim())
              .filter(Boolean),
            ...(type === "NUMBER" ? { number: { format: newFormat } } : {}),
          });
        }}
      >
        <h4 className="text-sm font-semibold">Add custom field</h4>
        <p className="text-xs text-muted-foreground">
          Track extra information on every{" "}
          {recordOf(state).singular.toLowerCase()}, such as estimates, links,
          amounts or review checkboxes. Fields appear in the table and details.
        </p>
        <Input
          aria-label="New field name"
          placeholder="Field name"
          required
          maxLength={80}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <select
          aria-label="New field type"
          className="task-select"
          value={type}
          onChange={(event) => setType(event.target.value)}
        >
          {fieldTypes.map((type) => (
            <option key={type} value={type}>
              {type.charAt(0) +
                type.slice(1).toLowerCase().replaceAll("_", " ")}
            </option>
          ))}
        </select>
        {type === "NUMBER" && (
          <NumberFormatPick
            label="New field format"
            value={newFormat}
            currency={state.currency}
            onChange={setNewFormat}
          />
        )}
        {["STATUS", "SINGLE_SELECT", "MULTI_SELECT", "TAGS"].includes(type) && (
          <Input
            aria-label="Field options"
            placeholder="Options, separated by commas"
            required
            value={options}
            onChange={(event) => setOptions(event.target.value)}
          />
        )}
        <Button size="sm" disabled={pending}>
          Add field
        </Button>
      </form>
      <form
        className="space-y-3 border-t pt-4"
        onSubmit={(event) => {
          event.preventDefault();
          onAction("group", { boardId: state.boardId, name: group });
        }}
      >
        <h4 className="text-sm font-semibold">Task groups</h4>
        <p className="text-xs text-muted-foreground">
          Groups organize tasks by sprint, team, or workstream—for example,
          Backlog or Sprint 1. Assign a group in task details, then use the
          board’s group filter to focus on it. Status tracks progress
          independently.
        </p>
        <Input
          aria-label="New group name"
          placeholder="Group name"
          required
          maxLength={80}
          value={group}
          onChange={(event) => setGroup(event.target.value)}
        />
        <Button size="sm" disabled={pending}>
          Add group
        </Button>
      </form>
    </section>
  );
}

/** Plain, currency or percent; system fields keep theirs. */
function NumberFormatPick({
  label,
  value,
  locked = false,
  currency = "PHP",
  onChange,
}: {
  label: string;
  value: NumberFormat;
  locked?: boolean;
  currency?: string;
  onChange: (value: NumberFormat) => void;
}) {
  return (
    <select
      aria-label={label}
      className="task-select"
      value={value}
      disabled={locked}
      onChange={(event) => onChange(event.target.value as NumberFormat)}
    >
      <option value="plain">Plain number</option>
      <option value="currency">Currency ({currency})</option>
      <option value="percent">Percent</option>
    </select>
  );
}
