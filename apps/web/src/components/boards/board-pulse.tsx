import type { BoardState } from "@/lib/board-contract";

/**
 * How the whole board is doing at a glance: share done, tasks per status and
 * what is overdue. Counts ignore filters so the bar doesn't jump around.
 */
export function BoardPulse({
  state,
  tone,
}: {
  state: BoardState;
  tone: (statusId: string | null, index: number) => string;
}) {
  const counts = state.pulse?.statusCounts;
  if (!counts) return null;
  const statuses =
    state.fields.find((field) => field.key === "status")?.options ?? [];
  const segments = [
    ...statuses.map((option, index) => ({
      id: option.id,
      label: option.label,
      count: counts[option.id] ?? 0,
      color: tone(option.id, index),
    })),
    ...(counts.__none__
      ? [
          {
            id: "__none__",
            label: "No status",
            count: counts.__none__,
            color: "var(--muted-foreground)",
          },
        ]
      : []),
  ];
  const total = segments.reduce((sum, item) => sum + item.count, 0);
  if (!total) return null;
  const done = counts.done ?? 0;
  const overdue = state.pulse?.overdue ?? 0;
  return (
    <section className="board-pulse" aria-label="Board progress">
      <p className="board-pulse-figure">
        <b>{Math.round((done / total) * 100)}%</b>
        <span>done</span>
      </p>
      <div className="board-pulse-track">
        <div className="board-pulse-bar" aria-hidden="true">
          {segments
            .filter((item) => item.count)
            .map((item) => (
              <span
                key={item.id}
                style={{ flexGrow: item.count, background: item.color }}
              />
            ))}
        </div>
        <ul className="board-pulse-legend">
          {segments.map((item) => (
            <li key={item.id}>
              <i style={{ background: item.color }} aria-hidden="true" />
              {item.label} {item.count}
            </li>
          ))}
        </ul>
      </div>
      <p className="board-pulse-figure" data-alert={overdue > 0 || undefined}>
        <b>{overdue}</b>
        <span>overdue</span>
      </p>
    </section>
  );
}
