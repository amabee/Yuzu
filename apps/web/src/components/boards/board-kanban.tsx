"use client";
import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type DropAnimation,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import gsap from "gsap";
import {
  Archive,
  Flag,
  GripVertical,
  Hourglass,
  MessageSquare,
  Paperclip,
  Plus,
} from "lucide-react";
import { VirtualTaskList } from "./virtual-task-list";
import {
  AssigneeAvatars,
  StatusIcon,
  formatDueDate,
  priorityOptions,
} from "./board-presentation";
import {
  coreKeys,
  type BoardField,
  type BoardState,
  type BoardTask,
} from "@/lib/board-contract";

export type KanbanLane = {
  key: string;
  label: string;
  statusId: string | null;
  tone: string;
  icon?: string | null;
  /** Whole-board count for this status, which may exceed the loaded tasks. */
  count: number;
  tasks: BoardTask[];
};

export type KanbanPlacement = {
  afterId: string | null;
  beforeId: string | null;
};

const laneId = (key: string) => `lane:${key}`;
const hotPriorities = new Set(["HIGH", "URGENT"]);
const reducedMotion = () =>
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * The Kanban: lanes by status, cards you can drag between and within lanes.
 * The dragged card's own slot becomes the dashed "lands here" placeholder.
 */
export function BoardKanban({
  lanes,
  state,
  busy,
  manualOrder,
  canAdd,
  formatCustom,
  onOpen,
  onArchive,
  onAdd,
  onShowStatus,
  onMove,
}: {
  lanes: KanbanLane[];
  state: BoardState;
  busy: boolean;
  /** Cards keep a manual order; other sorts only allow moving between lanes. */
  manualOrder: boolean;
  canAdd: boolean;
  formatCustom: (task: BoardTask, field: BoardField) => string;
  onOpen: (task: BoardTask) => void;
  onArchive: (task: BoardTask) => void;
  onAdd: (lane: KanbanLane) => void;
  onShowStatus: (lane: KanbanLane) => void;
  /** Returns false when the move waits for approval and the card stays put. */
  onMove: (move: {
    task: BoardTask;
    lane: KanbanLane;
    statusChanged: boolean;
    placement: KanbanPlacement | null;
  }) => boolean;
}) {
  // dnd-kit numbers its accessibility ids with a module counter, which differs
  // between the server and browser renders; a React id keeps them in step.
  const dndId = useId();
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 220, tolerance: 6 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const base = Object.fromEntries(
    lanes.map((lane) => [lane.key, lane.tasks.map((task) => task.id)]),
  );
  const signature = JSON.stringify(base);
  // While dragging (and until the board catches up) lanes follow this copy.
  const [items, setItems] = useState<Record<string, string[]> | null>(null);
  const [heldFor, setHeldFor] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [origin, setOrigin] = useState<string | null>(null);
  const latest = useRef<Record<string, string[]> | null>(null);
  if (heldFor !== null && heldFor !== signature && !activeId) {
    setHeldFor(null);
    setItems(null);
  }
  useEffect(() => {
    if (heldFor === null) return;
    const timer = window.setTimeout(() => {
      setHeldFor(null);
      setItems(null);
    }, 4000);
    return () => window.clearTimeout(timer);
  }, [heldFor]);
  const current = items ?? base;
  const byId = new Map(
    lanes.flatMap((lane) => lane.tasks.map((task) => [task.id, task])),
  );
  const laneOf = (id: string) =>
    id.startsWith("lane:")
      ? id.slice(5)
      : Object.keys(current).find((key) => current[key]!.includes(id));
  const laneLabel = (key?: string) =>
    lanes.find((lane) => lane.key === key)?.label ?? "this lane";
  const active = activeId ? byId.get(activeId) : undefined;

  const reset = () => {
    latest.current = null;
    setActiveId(null);
    setOrigin(null);
    setItems(null);
  };
  const handleStart = ({ active }: DragStartEvent) => {
    setActiveId(String(active.id));
    setOrigin(laneOf(String(active.id)) ?? null);
    latest.current = base;
    setItems(base);
    setHeldFor(null);
  };
  const handleOver = ({ active, over }: DragOverEvent) => {
    if (!over) return;
    const now = latest.current ?? base;
    const find = (key: string) =>
      key.startsWith("lane:")
        ? key.slice(5)
        : Object.keys(now).find((lane) => now[lane]!.includes(key));
    const from = find(String(active.id));
    const to = find(String(over.id));
    if (!from || !to || from === to) return;
    setItems(() => {
      const lists = now;
      const source = lists[from]!.filter((id) => id !== active.id);
      const target = [...lists[to]!];
      const overIndex = target.indexOf(String(over.id));
      const below =
        over.id !== laneId(to) &&
        active.rect.current.translated &&
        active.rect.current.translated.top >
          over.rect.top + over.rect.height / 2;
      const index = overIndex < 0 ? target.length : overIndex + (below ? 1 : 0);
      target.splice(index, 0, String(active.id));
      latest.current = { ...lists, [from]: source, [to]: target };
      return latest.current;
    });
  };
  const handleEnd = ({ active, over }: DragEndEvent) => {
    const id = String(active.id);
    const task = byId.get(id);
    // Read the latest arrangement directly: a quick drop can land before
    // React has re-rendered with the last drag-over.
    const lists = latest.current ?? base;
    const find = (key: string) =>
      key.startsWith("lane:")
        ? key.slice(5)
        : Object.keys(lists).find((lane) => lists[lane]!.includes(key));
    const from =
      origin ?? Object.keys(base).find((lane) => base[lane]!.includes(id));
    const overId = over ? String(over.id) : null;
    const to = (overId && find(overId)) || find(id);
    if (!task || !to || !from || !lists[to]) return reset();
    const before = lists[to]!;
    const list = before.filter((item) => item !== id);
    let index: number;
    if (overId && !overId.startsWith("lane:") && overId !== id) {
      const overIndex = list.indexOf(overId);
      const wasAbove =
        before.includes(id) && before.indexOf(id) < before.indexOf(overId);
      index = overIndex < 0 ? list.length : overIndex + (wasAbove ? 1 : 0);
    } else {
      const at = before.indexOf(id);
      index = at < 0 ? list.length : at;
    }
    list.splice(index, 0, id);
    const statusChanged = to !== from;
    const moved = statusChanged || index !== base[from]!.indexOf(id);
    const lane = lanes.find((item) => item.key === to)!;
    if (!moved || (!statusChanged && !manualOrder)) return reset();
    const shown = onMove({
      task,
      lane,
      statusChanged,
      placement: manualOrder
        ? {
            afterId: list[index - 1] ?? null,
            beforeId: list[index + 1] ?? null,
          }
        : null,
    });
    setActiveId(null);
    setOrigin(null);
    latest.current = null;
    if (!shown) return setItems(null);
    // Hold the new arrangement until the board data catches up.
    setItems({
      ...lists,
      [from]: lists[from]!.filter((item) => item !== id),
      [to]: list,
    });
    setHeldFor(signature);
  };

  const announcements: Announcements = {
    onDragStart: ({ active }) =>
      `Picked up ${byId.get(String(active.id))?.name ?? "task"}.`,
    onDragOver: ({ active, over }) =>
      over
        ? `${byId.get(String(active.id))?.name ?? "Task"} is over ${laneLabel(laneOf(String(over.id)))}.`
        : undefined,
    onDragEnd: ({ active, over }) =>
      over
        ? `${byId.get(String(active.id))?.name ?? "Task"} dropped in ${laneLabel(laneOf(String(over.id)))}.`
        : "Move cancelled.",
    onDragCancel: () => "Move cancelled.",
  };
  const dropAnimation: DropAnimation | null = reducedMotion()
    ? null
    : {
        duration: 220,
        easing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
        sideEffects: ({ active, dragOverlay }) => {
          const card = dragOverlay.node.querySelector(".task-card");
          if (card)
            gsap.to(card, {
              rotate: 0,
              scale: 1,
              duration: 0.2,
              ease: "power2.out",
            });
          active.node.style.opacity = "0";
          return () => {
            active.node.style.opacity = "";
            const landed = active.node.querySelector(".task-card");
            if (landed)
              gsap.fromTo(
                landed,
                { scale: 0.985 },
                {
                  scale: 1,
                  duration: 0.35,
                  ease: "back.out(3)",
                  clearProps: "transform",
                },
              );
          };
        },
      };

  return (
    <DndContext
      id={dndId}
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleStart}
      onDragOver={handleOver}
      onDragEnd={handleEnd}
      onDragCancel={reset}
      accessibility={{
        announcements,
        screenReaderInstructions: {
          draggable:
            "To move a task, press Space or Enter. Use the arrow keys to choose a lane and position, then press Space or Enter to drop it, or Escape to cancel.",
        },
      }}
    >
      <div className="board-lanes-scroll">
        <div
          className="board-lanes"
          style={{
            gridTemplateColumns: `repeat(${Math.max(1, lanes.length)}, minmax(240px, 1fr))`,
          }}
        >
          {lanes.map((lane) => (
            <Lane
              key={lane.key}
              lane={lane}
              ids={current[lane.key] ?? []}
              byId={byId}
              state={state}
              busy={busy}
              canAdd={canAdd}
              dragging={Boolean(activeId)}
              target={Boolean(activeId) && laneOf(activeId!) === lane.key}
              activeId={activeId}
              formatCustom={formatCustom}
              onOpen={onOpen}
              onArchive={onArchive}
              onAdd={onAdd}
              onShowStatus={onShowStatus}
            />
          ))}
        </div>
      </div>
      <DragOverlay dropAnimation={dropAnimation}>
        {active ? (
          <LiftedCard>
            <TaskCard
              task={active}
              state={state}
              busy={busy}
              formatCustom={formatCustom}
              overlay
            />
          </LiftedCard>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

function Lane({
  lane,
  ids,
  byId,
  state,
  busy,
  canAdd,
  dragging,
  target,
  activeId,
  formatCustom,
  onOpen,
  onArchive,
  onAdd,
  onShowStatus,
}: {
  lane: KanbanLane;
  ids: string[];
  byId: Map<string, BoardTask>;
  state: BoardState;
  busy: boolean;
  canAdd: boolean;
  dragging: boolean;
  target: boolean;
  activeId: string | null;
  formatCustom: (task: BoardTask, field: BoardField) => string;
  onOpen: (task: BoardTask) => void;
  onArchive: (task: BoardTask) => void;
  onAdd: (lane: KanbanLane) => void;
  onShowStatus: (lane: KanbanLane) => void;
}) {
  const { setNodeRef } = useDroppable({ id: laneId(lane.key) });
  const [expanded, setExpanded] = useState(false);
  const done = lane.statusId === "done";
  const tasks = ids.flatMap((id) => byId.get(id) ?? []);
  // Done folds after a few cards, unless something is being dropped there.
  const folded = done && !expanded && !dragging && tasks.length > 3;
  const shown = folded ? tasks.slice(0, 3) : tasks;
  return (
    <section
      ref={setNodeRef}
      className="board-lane"
      data-target={target || undefined}
      data-done={done || undefined}
      style={{ "--lane-tone": lane.tone } as React.CSSProperties}
    >
      <header className="board-lane-header">
        <StatusIcon
          icon={
            (lane.icon ?? undefined) as React.ComponentProps<
              typeof StatusIcon
            >["icon"]
          }
        />
        <h2>{lane.label}</h2>
        <span className="board-lane-count">{lane.count}</span>
        {canAdd && (
          <button
            type="button"
            className="board-lane-add"
            aria-label={`Add task to ${lane.label}`}
            title={`Add task to ${lane.label}`}
            onClick={() => onAdd(lane)}
          >
            <Plus size={15} />
          </button>
        )}
      </header>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <div className="board-lane-cards">
          <VirtualTaskList items={shown} pinnedId={activeId}>
            {(task) => (
              <SortableCard
                key={task.id}
                task={task}
                state={state}
                busy={busy}
                formatCustom={formatCustom}
                onOpen={onOpen}
                onArchive={onArchive}
              />
            )}
          </VirtualTaskList>
        </div>
      </SortableContext>
      {folded && (
        <button
          type="button"
          className="board-lane-more"
          onClick={() => setExpanded(true)}
        >
          Show {tasks.length - 3} more done
        </button>
      )}
      {!tasks.length &&
        (lane.count ? (
          <div className="board-lane-empty">
            <p>No tasks from this status on this page.</p>
            <button type="button" onClick={() => onShowStatus(lane)}>
              Show {lane.label}
            </button>
          </div>
        ) : (
          <p className="board-lane-empty">
            {dragging ? "Drop here" : "No tasks yet on this status."}
          </p>
        ))}
      {canAdd && (
        <button
          type="button"
          className="board-lane-add-row"
          aria-label={`Add task to ${lane.label}`}
          onClick={() => onAdd(lane)}
        >
          <Plus size={14} />
          Add task
        </button>
      )}
    </section>
  );
}

function SortableCard({
  task,
  state,
  busy,
  formatCustom,
  onOpen,
  onArchive,
}: {
  task: BoardTask;
  state: BoardState;
  busy: boolean;
  formatCustom: (task: BoardTask, field: BoardField) => string;
  onOpen: (task: BoardTask) => void;
  onArchive: (task: BoardTask) => void;
}) {
  const {
    setNodeRef,
    setActivatorNodeRef,
    listeners,
    attributes,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id, disabled: !task.canEdit || busy });
  return (
    <div
      ref={setNodeRef}
      className="task-card-slot"
      data-placeholder={isDragging || undefined}
      style={{ transform: CSS.Translate.toString(transform), transition }}
    >
      <TaskCard
        task={task}
        state={state}
        busy={busy}
        formatCustom={formatCustom}
        onOpen={onOpen}
        onArchive={onArchive}
        cardProps={{
          onMouseDown: listener(listeners, "onMouseDown"),
          onTouchStart: listener(listeners, "onTouchStart"),
        }}
        handle={
          task.canEdit ? (
            <button
              type="button"
              ref={setActivatorNodeRef}
              className="task-drag-handle"
              aria-label={`Drag ${task.name}`}
              title="Drag to move. Space picks it up from the keyboard."
              disabled={busy}
              {...attributes}
              aria-roledescription="draggable task"
              onKeyDown={listener(listeners, "onKeyDown")}
            >
              <GripVertical size={15} />
            </button>
          ) : null
        }
      />
    </div>
  );
}

function TaskCard({
  task,
  state,
  busy,
  formatCustom,
  onOpen,
  onArchive,
  handle,
  cardProps,
  overlay = false,
}: {
  task: BoardTask;
  state: BoardState;
  busy: boolean;
  formatCustom: (task: BoardTask, field: BoardField) => string;
  onOpen?: (task: BoardTask) => void;
  onArchive?: (task: BoardTask) => void;
  handle?: React.ReactNode;
  cardProps?: React.HTMLAttributes<HTMLElement>;
  overlay?: boolean;
}) {
  const today = state.calendarDate ?? new Date().toISOString().slice(0, 10);
  const done = task.statusId === "done";
  const due = task.dueDate;
  const dueState =
    !due || done
      ? undefined
      : due < today
        ? "late"
        : due <= addDays(today, 1)
          ? "soon"
          : undefined;
  const priority = priorityOptions(state).find(
    (option) => option.id === task.priority,
  );
  // With a single group every card would repeat it, so only show real choices.
  const group =
    state.groups.length > 1
      ? state.groups.find((item) => item.id === task.groupId)
      : undefined;
  const pending = state.pendingApprovals.some(
    (proposal) => proposal.taskId === task.id,
  );
  const tags = state.fields
    .filter(
      (field) =>
        !coreKeys.includes(field.key) &&
        ["TAGS", "SINGLE_SELECT", "STATUS"].includes(field.type),
    )
    .flatMap((field) => {
      const value = task.fieldValues[field.id];
      const ids = Array.isArray(value)
        ? value
        : typeof value === "string" && value
          ? [value]
          : [];
      return ids.map((id) => {
        const option = field.options.find((item) => item.id === id);
        return {
          key: `${field.id}-${id}`,
          label: option?.label ?? formatCustom(task, field),
          color: option?.color ?? undefined,
          field: field.name,
        };
      });
    });
  const checklists = [
    ...state.fields
      .filter((field) => field.type === "MULTI_SELECT")
      .flatMap((field) => {
        const value = task.fieldValues[field.id];
        const picked = Array.isArray(value) ? value.length : 0;
        return picked
          ? [
              {
                key: field.id,
                name: field.name,
                done: picked,
                total: field.options.length,
                label: undefined as string | undefined,
              },
            ]
          : [];
      }),
    ...(task.checklist.length
      ? [
          {
            key: "checklist",
            name: "Checklist",
            done: task.checklist.filter((item) => item.done).length,
            total: task.checklist.length,
            label: `Checklist progress for ${task.name}`,
          },
        ]
      : []),
  ];
  return (
    <article
      data-task-id={task.id}
      className="task-card"
      data-done={done || undefined}
      data-overlay={overlay || undefined}
      {...cardProps}
      onClick={(event) => {
        if (
          (event.target as HTMLElement).closest(
            "button,a,input,select,textarea",
          )
        )
          return;
        onOpen?.(task);
      }}
    >
      {!overlay && (handle || task.canEdit) && (
        <div className="task-card-actions">
          {handle}
          {task.canEdit && (
            <button
              type="button"
              className="task-card-action"
              aria-label={`${state.approvalPolicy.enabled && state.approvalPolicy.requireArchive ? "Request archive for" : "Archive"} ${task.name}`}
              title="Archive task"
              disabled={busy}
              onClick={() => onArchive?.(task)}
            >
              <Archive size={14} />
            </button>
          )}
        </div>
      )}
      {pending && (
        <Link className="task-card-pending" href="/approvals">
          <Hourglass size={12} aria-hidden="true" />
          Awaiting approval
        </Link>
      )}
      {(group || hotPriorities.has(task.priority)) && (
        <div className="task-card-tags">
          {hotPriorities.has(task.priority) && (
            <span
              className="task-card-priority"
              style={
                priority?.color
                  ? ({ "--priority": priority.color } as React.CSSProperties)
                  : undefined
              }
            >
              <Flag size={11} aria-hidden="true" />
              {priority?.label ?? task.priority}
            </span>
          )}
          {group && <span className="task-card-group">{group.name}</span>}
        </div>
      )}
      <div className="task-custom-tags">
        {tags.map((tag) => (
          <span key={tag.key} title={`${tag.field}: ${tag.label}`}>
            <i
              aria-hidden="true"
              style={tag.color ? { background: tag.color } : undefined}
            />
            {tag.label}
          </span>
        ))}
      </div>
      <div className="task-card-heading">
        <button
          type="button"
          className="task-card-title"
          tabIndex={overlay ? -1 : undefined}
          onClick={() => onOpen?.(task)}
        >
          {task.name}
        </button>
      </div>
      <div className="task-card-meta">
        {due && (
          <time
            className="task-card-date"
            dateTime={due}
            data-state={dueState}
            title={`Target date: ${formatDueDate(due, true)}`}
          >
            {formatDueDate(due)}
          </time>
        )}
        {checklists.map((item) => (
          <span
            key={item.key}
            className="task-checklist-summary"
            title={`${item.name}: ${item.done} of ${item.total}`}
            aria-label={item.label}
          >
            <ProgressRing value={item.done} total={item.total} />
            {item.done}/{item.total}
          </span>
        ))}
        {(task.commentCount ?? 0) > 0 ? (
          <button
            type="button"
            className="task-comment-count"
            data-empty={!task.commentCount || undefined}
            aria-label={`Comments for ${task.name}`}
            tabIndex={overlay ? -1 : undefined}
            onClick={() => onOpen?.(task)}
          >
            <MessageSquare size={13} aria-hidden="true" />
            {task.commentCount ?? 0}
          </button>
        ) : null}
        {(task.attachmentCount ?? 0) > 0 && (
          <span className="task-card-files" title="Files">
            <Paperclip size={13} aria-hidden="true" />
            {task.attachmentCount}
          </span>
        )}
        {task.assigneeIds.length > 0 && (
          <span className="task-card-people">
            <AssigneeAvatars ids={task.assigneeIds} people={state.people} />
          </span>
        )}
      </div>
    </article>
  );
}

function ProgressRing({ value, total }: { value: number; total: number }) {
  const circumference = 2 * Math.PI * 5.5;
  const filled = total ? (value / total) * circumference : 0;
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <circle cx="7" cy="7" r="5.5" className="ring-track" />
      <circle
        cx="7"
        cy="7"
        r="5.5"
        className="ring-fill"
        strokeDasharray={`${filled} ${circumference}`}
        transform="rotate(-90 7 7)"
      />
    </svg>
  );
}

/** Lifts the dragged card with a small tilt that leans into the movement. */
function LiftedCard({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const card = ref.current?.querySelector(".task-card");
    if (!card || reducedMotion()) return;
    gsap.fromTo(
      card,
      { rotate: 0, scale: 1 },
      { rotate: 2, scale: 1.03, duration: 0.18, ease: "power2.out" },
    );
    const lean = gsap.quickTo(card, "rotate", {
      duration: 0.45,
      ease: "power3.out",
    });
    let last: number | null = null;
    let settle = 0;
    const move = (event: PointerEvent) => {
      if (last !== null) {
        const tilt = Math.max(-3, Math.min(3, (event.clientX - last) * 0.25));
        lean(2 + tilt);
        window.clearTimeout(settle);
        settle = window.setTimeout(() => lean(2), 120);
      }
      last = event.clientX;
    };
    window.addEventListener("pointermove", move);
    return () => {
      window.removeEventListener("pointermove", move);
      window.clearTimeout(settle);
    };
  }, []);
  return (
    <div ref={ref} className="task-card-lifted">
      {children}
    </div>
  );
}

function addDays(day: string, days: number) {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** dnd-kit types its listeners loosely; hand one to a React event prop. */
function listener<E extends React.SyntheticEvent>(
  listeners: Record<string, unknown> | undefined,
  name: string,
) {
  return listeners?.[name] as ((event: E) => void) | undefined;
}
