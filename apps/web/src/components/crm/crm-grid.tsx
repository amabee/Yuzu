"use client";
import {
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import {
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, Maximize2 } from "lucide-react";
import {
  profileLabel,
  profileSchemas,
  type CrmDirectory,
  type CrmRecord,
  type ProfileKey,
} from "@/lib/crm-contract";
import type { CrmChanges, CrmType, DirectoryQuery } from "./use-crm";
import { Initials, OwnerName } from "./crm-parts";

/** A grid column: the record value it shows and how it is edited. */
type Column = {
  key: string;
  label: string;
  size: number;
  kind: "name" | "text" | "owner" | "created" | "primary" | "people";
  profile?: ProfileKey;
};
export function crmColumns(type: CrmType): Column[] {
  const profile = (key: ProfileKey, size: number): Column => ({
    key,
    label: profileLabel(type, key),
    size,
    kind: "text",
    profile: key,
  });
  return type === "COMPANY"
    ? [
        { key: "name", label: "Company", size: 260, kind: "name" },
        profile("domain", 180),
        profile("email", 220),
        profile("phone", 170),
        { key: "owner", label: "Owner", size: 170, kind: "owner" },
        { key: "people", label: "People", size: 100, kind: "people" },
        profile("website", 220),
        profile("legalName", 220),
        profile("address", 260),
        { key: "created", label: "Added", size: 120, kind: "created" },
      ]
    : [
        { key: "name", label: "Contact", size: 250, kind: "name" },
        profile("email", 240),
        profile("phone", 180),
        {
          key: "primary",
          label: "Primary company",
          size: 210,
          kind: "primary",
        },
        { key: "owner", label: "Owner", size: 170, kind: "owner" },
        { key: "created", label: "Added", size: 120, kind: "created" },
      ];
}
const sortable: Record<string, ["name" | "created", "-name" | "-created"]> = {
  name: ["name", "-name"],
  created: ["created", "-created"],
};
const valueOf = (record: CrmRecord, column: Column) =>
  column.kind === "name"
    ? record.name
    : column.kind === "owner"
      ? (record.ownerId ?? "")
      : column.kind === "primary"
        ? (record.primaryCompany?.name ?? "")
        : column.kind === "people"
          ? String(record.currentPeople ?? 0)
          : column.profile
            ? (record.profile[column.profile] ?? "")
            : "";
const dateLabel = (value: string) =>
  new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(
    new Date(value),
  );

/** Checks a cell's new value the way the server will, so mistakes show in
 *  place. The server still validates everything. */
function check(column: Column, value: string): string | null {
  if (column.kind === "name")
    return value.trim()
      ? value.trim().length > 200
        ? "Use 200 characters or fewer."
        : null
      : "A name is required.";
  if (!column.profile) return null;
  const parsed = profileSchemas[column.profile].safeParse(value);
  return parsed.success
    ? null
    : (parsed.error.issues[0]?.message ?? "Check this value.");
}
function changeFor(column: Column, value: string): CrmChanges {
  if (column.kind === "name") return { name: value.trim() };
  if (column.kind === "owner") return { assigneeIds: value ? [value] : [] };
  return { [column.profile!]: value.trim() || null };
}

type Cell = { row: number; column: number };
export function CrmGrid({
  type,
  directory,
  query,
  hidden,
  onSort,
  onSave,
  onOpen,
  addRow,
  onBlocked,
  onOpenLinked,
  continueIn,
  onContinued,
}: {
  onOpenLinked: (id: string) => void;
  type: CrmType;
  directory: CrmDirectory;
  query: DirectoryQuery;
  hidden: string[];
  onSort: (sort: DirectoryQuery["sort"]) => void;
  onSave: (record: CrmRecord, changes: CrmChanges) => void;
  onOpen: (record: CrmRecord) => void;
  addRow: React.ReactNode;
  onBlocked: (message: string) => void;
  /** A record just added with Tab: start editing its next cell. */
  continueIn: string | null;
  onContinued: () => void;
}) {
  const records = directory.records;
  const people = directory.people;
  const all = useMemo(() => crmColumns(type), [type]);
  const visible = useMemo(
    () =>
      all.filter(
        (column) => column.kind === "name" || !hidden.includes(column.key),
      ),
    [all, hidden],
  );
  const [active, setActive] = useState<Cell | null>(null);
  type Editing = { cell: Cell; value: string; error: string | null };
  const [editing, setEditingState] = useState<Editing | null>(null);
  // The latest edit, read synchronously: a blur after Enter or a pick must
  // not save the same edit twice.
  const editingRef = useRef<Editing | null>(null);
  const setEditing = (next: Editing | null) => {
    editingRef.current = next;
    setEditingState(next);
  };
  const tableRef = useRef<HTMLTableElement>(null);
  const columns = useMemo<ColumnDef<CrmRecord>[]>(
    () =>
      visible.map((column) => ({
        id: column.key,
        size: column.size,
        minSize: 90,
        header: column.label,
        meta: column,
      })),
    [visible],
  );
  // The table re-renders with its rows; the compiler skips memoizing it.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: records,
    columns,
    getRowId: (record) => record.id,
    getCoreRowModel: getCoreRowModel(),
    columnResizeMode: "onChange",
    enableColumnResizing: true,
  });
  // Keep the active cell inside the grid as rows and columns change.
  const current =
    active && active.row < records.length && active.column < visible.length
      ? active
      : null;
  useEffect(() => {
    if (!current || editing) return;
    tableRef.current
      ?.querySelector<HTMLElement>(
        `[data-cell="${current.row}:${current.column}"]`,
      )
      ?.focus();
  }, [current, editing]);

  const editable = (record: CrmRecord, column: Column) => {
    if (column.kind === "created")
      return "This shows when the record was added.";
    if (column.kind === "primary")
      return "Choose the primary company on the contact's card, under Companies.";
    if (column.kind === "people")
      return "People are linked from the company's card, under People.";
    if (record.archivedAt)
      return "Archived records are read-only. Restore it to edit.";
    if (!record.canEdit)
      return "Only its owner, creator, editors and managers can change this record.";
    return null;
  };
  const startEdit = (cell: Cell, initial?: string) => {
    const record = records[cell.row]!;
    const column = visible[cell.column]!;
    const blocked = editable(record, column);
    if (blocked) return onBlocked(blocked);
    setActive(cell);
    setEditing({
      cell,
      value: initial ?? valueOf(record, column),
      error: null,
    });
  };
  const commit = (move?: "down" | "right" | "left", picked?: string) => {
    const editing = editingRef.current;
    if (!editing) return;
    const value = picked ?? editing.value;
    const record = records[editing.cell.row]!;
    const column = visible[editing.cell.column]!;
    const error = check(column, value);
    if (error) return setEditing({ ...editing, value, error });
    if (value.trim() !== valueOf(record, column).trim())
      onSave(record, changeFor(column, value));
    setEditing(null);
    const { row, column: col } = editing.cell;
    setActive(
      move === "down"
        ? { row: Math.min(row + 1, records.length - 1), column: col }
        : move === "right"
          ? { row, column: Math.min(col + 1, visible.length - 1) }
          : move === "left"
            ? { row, column: Math.max(col - 1, 0) }
            : editing.cell,
    );
  };
  // Once the new record shows up, carry on in its second column.
  const carryOn = useEffectEvent((id: string) => {
    const row = records.findIndex((record) => record.id === id);
    if (row < 0) return;
    onContinued();
    const cell = { row, column: Math.min(1, visible.length - 1) };
    if (editable(records[row]!, visible[cell.column]!)) setActive(cell);
    else startEdit(cell);
  });
  useEffect(() => {
    if (continueIn) carryOn(continueIn);
  }, [continueIn, records]);
  const cancel = () => {
    if (editingRef.current) setActive(editingRef.current.cell);
    setEditing(null);
  };
  const onCellKey = (event: KeyboardEvent, cell: Cell) => {
    const record = records[cell.row]!;
    const move = (row: number, column: number) => {
      event.preventDefault();
      setActive({
        row: Math.max(0, Math.min(records.length - 1, row)),
        column: Math.max(0, Math.min(visible.length - 1, column)),
      });
    };
    switch (event.key) {
      case "ArrowDown":
        return move(cell.row + 1, cell.column);
      case "ArrowUp":
        return move(cell.row - 1, cell.column);
      case "ArrowRight":
        return move(cell.row, cell.column + 1);
      case "ArrowLeft":
        return move(cell.row, cell.column - 1);
      case "Tab": {
        // Across the row, as in a spreadsheet; past either end, Tab leaves
        // the grid as usual.
        const next = cell.column + (event.shiftKey ? -1 : 1);
        if (next < 0 || next >= visible.length) return;
        return move(cell.row, next);
      }
      case "Home":
        return move(cell.row, 0);
      case "End":
        return move(cell.row, visible.length - 1);
      case "Enter":
      case "F2":
        event.preventDefault();
        return startEdit(cell);
      case " ":
        event.preventDefault();
        return onOpen(record);
      default:
        // Typing a character starts editing with it, as in a spreadsheet.
        if (
          event.key.length === 1 &&
          !event.ctrlKey &&
          !event.metaKey &&
          !event.altKey &&
          visible[cell.column]!.kind !== "owner"
        ) {
          event.preventDefault();
          startEdit(cell, event.key);
        }
    }
  };
  const sortIcon = (key: string) => {
    const pair = sortable[key];
    if (!pair) return null;
    if (query.sort === pair[0]) return <ArrowUp size={13} aria-hidden="true" />;
    if (query.sort === pair[1])
      return <ArrowDown size={13} aria-hidden="true" />;
    return null;
  };

  return (
    <div className="crm-grid-scroll">
      <table
        ref={tableRef}
        role="grid"
        aria-label={type === "COMPANY" ? "Companies" : "Contacts"}
        aria-rowcount={directory.total + 2}
        className="crm-grid"
        style={{ width: table.getTotalSize() }}
      >
        <thead>
          {table.getHeaderGroups().map((group) => (
            <tr key={group.id}>
              {group.headers.map((header, index) => {
                const column = header.column.columnDef.meta as Column;
                const pair = sortable[column.key];
                const ariaSort =
                  pair && query.sort === pair[0]
                    ? "ascending"
                    : pair && query.sort === pair[1]
                      ? "descending"
                      : undefined;
                return (
                  <th
                    key={header.id}
                    scope="col"
                    aria-sort={ariaSort}
                    className={index === 0 ? "crm-pin" : undefined}
                    style={{ width: header.getSize() }}
                  >
                    {pair ? (
                      <button
                        type="button"
                        className="crm-th"
                        onClick={() =>
                          onSort(query.sort === pair[0] ? pair[1] : pair[0])
                        }
                      >
                        {column.label}
                        {sortIcon(column.key)}
                      </button>
                    ) : (
                      <span className="crm-th">{column.label}</span>
                    )}
                    <span
                      role="separator"
                      aria-orientation="vertical"
                      aria-label={`Resize ${column.label}`}
                      className="crm-resize"
                      data-resizing={header.column.getIsResizing() || undefined}
                      onMouseDown={header.getResizeHandler()}
                      onTouchStart={header.getResizeHandler()}
                      onDoubleClick={() => header.column.resetSize()}
                    />
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row, rowIndex) => {
            const record = row.original;
            return (
              <tr
                key={row.id}
                data-archived={record.archivedAt ? "" : undefined}
                aria-rowindex={rowIndex + 2}
              >
                {row.getVisibleCells().map((cell, columnIndex) => {
                  const column = cell.column.columnDef.meta as Column;
                  const here = { row: rowIndex, column: columnIndex };
                  const isActive =
                    current?.row === rowIndex && current.column === columnIndex;
                  const isEditing =
                    editing?.cell.row === rowIndex &&
                    editing.cell.column === columnIndex;
                  const value = valueOf(record, column);
                  return (
                    <td
                      key={cell.id}
                      role="gridcell"
                      data-cell={`${rowIndex}:${columnIndex}`}
                      tabIndex={
                        isActive ||
                        (!current && rowIndex === 0 && columnIndex === 0)
                          ? 0
                          : -1
                      }
                      aria-selected={isActive}
                      aria-readonly={
                        Boolean(editable(record, column)) || undefined
                      }
                      data-editing={isEditing || undefined}
                      data-invalid={(isEditing && editing.error) || undefined}
                      className={columnIndex === 0 ? "crm-pin" : undefined}
                      style={{ width: cell.column.getSize() }}
                      onClick={() => setActive(here)}
                      onDoubleClick={() => startEdit(here)}
                      onKeyDown={(event) =>
                        !isEditing && onCellKey(event, here)
                      }
                    >
                      {isEditing ? (
                        <CellEditor
                          column={column}
                          value={editing.value}
                          error={editing.error}
                          people={people}
                          onChange={(value) =>
                            setEditing({ ...editing, value, error: null })
                          }
                          onCommit={commit}
                          onCancel={cancel}
                        />
                      ) : column.kind === "name" ? (
                        <div className="crm-namecell">
                          <Initials
                            name={record.name}
                            person={type === "CONTACT"}
                          />
                          <span className="crm-name">{record.name}</span>
                          {record.archivedAt && (
                            <span className="crm-tag">Archived</span>
                          )}
                          <button
                            type="button"
                            className="crm-open"
                            tabIndex={isActive ? 0 : -1}
                            onClick={(event) => {
                              event.stopPropagation();
                              onOpen(record);
                            }}
                            aria-label={`Open ${record.name}`}
                          >
                            <Maximize2 size={13} aria-hidden="true" />
                            Open
                          </button>
                        </div>
                      ) : column.kind === "owner" ? (
                        <div className="crm-cell">
                          {value ? (
                            <OwnerName people={people} id={value} />
                          ) : (
                            <span className="crm-empty">No owner</span>
                          )}
                        </div>
                      ) : column.kind === "primary" ? (
                        <div className="crm-cell">
                          {record.primaryCompany ? (
                            <button
                              type="button"
                              className="crm-cell-link"
                              tabIndex={isActive ? 0 : -1}
                              onClick={(event) => {
                                event.stopPropagation();
                                onOpenLinked(record.primaryCompany!.id);
                              }}
                            >
                              {record.primaryCompany.name}
                            </button>
                          ) : (
                            <span className="crm-empty">—</span>
                          )}
                        </div>
                      ) : column.kind === "people" ? (
                        <div className="crm-cell crm-num">
                          {record.currentPeople ?? 0}
                        </div>
                      ) : column.kind === "created" ? (
                        <div className="crm-cell crm-muted">
                          {dateLabel(record.createdAt)}
                        </div>
                      ) : (
                        <div className="crm-cell" title={value || undefined}>
                          {value || <span className="crm-empty">—</span>}
                        </div>
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
          {addRow && (
            <tr className="crm-addrow">
              <td
                className="crm-pin"
                style={{ width: table.getVisibleLeafColumns()[0]?.getSize() }}
              >
                {addRow}
              </td>
              <td
                colSpan={Math.max(1, visible.length - 1)}
                aria-hidden="true"
              />
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function CellEditor({
  column,
  value,
  error,
  people,
  onChange,
  onCommit,
  onCancel,
}: {
  column: Column;
  value: string;
  error: string | null;
  people: CrmDirectory["people"];
  onChange: (value: string) => void;
  onCommit: (move?: "down" | "right" | "left", value?: string) => void;
  onCancel: () => void;
}) {
  const id = `crm-cell-error-${column.key}`;
  const keys = (event: KeyboardEvent) => {
    if (event.key === "Enter") {
      event.preventDefault();
      onCommit("down");
    } else if (event.key === "Tab") {
      event.preventDefault();
      onCommit(event.shiftKey ? "left" : "right");
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onCancel();
    }
  };
  if (column.kind === "owner")
    return (
      <select
        autoFocus
        className="crm-editor"
        aria-label={column.label}
        value={value}
        // Choosing an owner saves straight away.
        onChange={(event) => onCommit(undefined, event.target.value)}
        onKeyDown={keys}
        onBlur={() => onCommit()}
      >
        <option value="">No owner</option>
        {people
          .filter((person) => !person.deactivated || person.id === value)
          .map((person) => (
            <option key={person.id} value={person.id}>
              {person.name}
              {person.deactivated ? " (deactivated)" : ""}
            </option>
          ))}
      </select>
    );
  return (
    <>
      <input
        autoFocus
        className="crm-editor"
        aria-label={column.label}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? id : undefined}
        value={value}
        type={column.profile === "email" ? "email" : "text"}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={keys}
        onBlur={() => onCommit()}
        onFocus={(event) => {
          // Typing to start keeps the caret after the typed character.
          const end = event.target.value.length;
          event.target.setSelectionRange(end, end);
        }}
      />
      {error && (
        <span id={id} role="alert" className="crm-cell-error">
          {error}
        </span>
      )}
    </>
  );
}
