"use client";
import { useState } from "react";
import { ApprovalPolicyEditor } from "./approval-policy-editor";
import { Button } from "@/components/ui/button";
import { ArrowUp, ArrowDown, GripVertical } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  fieldTypes,
  coreKeys,
  statusIcons,
  priorities,
  type BoardState,
  type BoardField,
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
          });
        }}
      >
        <fieldset disabled={pending} className="space-y-3">
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
  return (
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
  const [group, setGroup] = useState("");
  const [manager, setManager] = useState("");
  return (
    <section className="space-y-4 border-t pt-5">
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
                .filter((person) => !state.managerIds.includes(person.id))
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
      {state.fields.map((field) => (
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
          });
        }}
      >
        <h4 className="text-sm font-semibold">Add custom field</h4>
        <p className="text-xs text-muted-foreground">
          Track extra information on every task, such as estimates, links, or
          review checkboxes. Fields appear in the table and task details.
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
