"use client";
import { Fragment, useRef, type ReactNode } from "react";
import { defaultRangeExtractor, useVirtualizer } from "@tanstack/react-virtual";

export function VirtualTaskList<T extends { id: string }>({
  items,
  children,
  pinnedId,
}: {
  items: T[];
  children: (item: T) => ReactNode;
  pinnedId?: string | null;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const pinnedIndex = items.findIndex((item) => item.id === pinnedId);
  // Keep the source mounted during native drag, even when the lane scrolls.
  // TanStack Virtual exposes mutable measurement functions; React Compiler must not memoize them.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtual = useVirtualizer({
    count: items.length,
    getScrollElement: () => ref.current,
    estimateSize: () => 160,
    overscan: 3,
    getItemKey: (index) => items[index].id,
    rangeExtractor: (range) =>
      [
        ...new Set([
          ...defaultRangeExtractor(range),
          ...(pinnedIndex >= 0 ? [pinnedIndex] : []),
        ]),
      ].sort((a, b) => a - b),
    initialRect: { width: 240, height: 600 },
    useFlushSync: false,
  });
  if (items.length <= 20) return <>{items.map((item) => children(item))}</>;
  return (
    <div
      ref={ref}
      className="max-h-[650px] overflow-y-auto"
      tabIndex={0}
      aria-label="Scroll tasks in this status"
    >
      <div style={{ height: virtual.getTotalSize(), position: "relative" }}>
        {virtual.getVirtualItems().map((row) => (
          <div
            key={row.key}
            ref={virtual.measureElement}
            data-index={row.index}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              transform: `translateY(${row.start}px)`,
              paddingBottom: 8,
            }}
          >
            {children(items[row.index])}
          </div>
        ))}
      </div>
    </div>
  );
}

export function VirtualTableBody<T extends { id: string }>({
  items,
  columns,
  children,
  renderAfter,
}: {
  items: T[];
  columns: number;
  children: (item: T) => ReactNode;
  renderAfter?: (item: T) => ReactNode;
}) {
  const body = useRef<HTMLTableSectionElement>(null);
  // TanStack Virtual exposes mutable measurement functions; React Compiler must not memoize them.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtual = useVirtualizer({
    count: items.length,
    getScrollElement: () =>
      body.current?.closest(".board-table-scroll") as HTMLDivElement | null,
    estimateSize: () => 64,
    overscan: 5,
    getItemKey: (index) => items[index].id,
    initialRect: { width: 800, height: 650 },
    useFlushSync: false,
  });
  // An expanded breakdown has variable row heights. Render this bounded board
  // page normally while one parent is open; keep virtualization for flat pages.
  if (items.length <= 20 || renderAfter)
    return (
      <tbody>
        {items.map((item) => (
          <Fragment key={item.id}>
            {children(item)}
            {renderAfter?.(item)}
          </Fragment>
        ))}
      </tbody>
    );
  const rows = virtual.getVirtualItems();
  const first = rows[0],
    last = rows.at(-1);
  return (
    <tbody ref={body}>
      {first && first.start > 0 && (
        <tr aria-hidden="true">
          <td colSpan={columns} style={{ height: first.start, padding: 0 }} />
        </tr>
      )}
      {rows.map((row) => (
        <MeasuredRow
          key={row.key}
          index={row.index}
          measure={virtual.measureElement}
        >
          {children(items[row.index])}
        </MeasuredRow>
      ))}
      {last && last.end < virtual.getTotalSize() && (
        <tr aria-hidden="true">
          <td
            colSpan={columns}
            style={{ height: virtual.getTotalSize() - last.end, padding: 0 }}
          />
        </tr>
      )}
    </tbody>
  );
}

// Clone the actual tr, preserving table semantics and its task ID.
import { cloneElement, isValidElement } from "react";
function MeasuredRow({
  children,
  index,
  measure,
}: {
  children: ReactNode;
  index: number;
  measure: (node: Element | null) => void;
}) {
  return isValidElement<Record<string, unknown>>(children)
    ? cloneElement(children, { ref: measure, "data-index": index })
    : null;
}
