"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link2, Plus, X } from "lucide-react";
import { z } from "zod";
import { Popover } from "radix-ui";
import { apiRequest } from "@/lib/api-client";
import type { LinkedRecord } from "@/lib/record-links";

const optionsSchema = z.object({
  options: z.array(z.object({ id: z.string(), name: z.string() })),
});

/** Chips for a record's links; private ones show without a name. */
export function LinkChips({
  ids,
  linked,
  limit,
}: {
  ids: string[];
  linked: Record<string, LinkedRecord> | undefined;
  /** Show this many, then "+N". */
  limit?: number;
}) {
  const shown = limit ? ids.slice(0, limit) : ids;
  return (
    <span className="link-chips">
      {shown.map((id) => {
        const record = linked?.[id];
        return (
          <span
            key={id}
            className="link-chip"
            data-private={!record || undefined}
            data-archived={record?.archived || undefined}
          >
            <Link2 size={11} aria-hidden="true" />
            {record?.name ?? "Private item"}
          </span>
        );
      })}
      {limit && ids.length > limit && (
        <span className="link-chip" data-more>
          +{ids.length - limit}
        </span>
      )}
    </span>
  );
}

/** Edits a link field: remove chips, or search the other board to add. */
export function LinkPicker({
  fieldId,
  label,
  value,
  linked,
  many,
  currentUserId,
  disabled,
  onChange,
}: {
  fieldId: string;
  label: string;
  value: string[];
  linked: Record<string, LinkedRecord> | undefined;
  many: boolean;
  currentUserId: string;
  disabled?: boolean;
  onChange: (ids: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  // Names picked in this session, before the board reloads them.
  const [picked, setPicked] = useState<Record<string, LinkedRecord>>({});
  const names = { ...linked, ...picked };
  const options = useQuery({
    queryKey: ["principal", currentUserId, "link-options", fieldId, q],
    enabled: open,
    queryFn: async ({ signal }) =>
      optionsSchema.parse(
        (
          await apiRequest(
            `/api/v1/boards/link-options?fieldId=${fieldId}&q=${encodeURIComponent(q)}`,
            { signal },
          )
        ).data,
      ).options,
  });
  return (
    <div className="link-picker" role="group" aria-label={label}>
      {value.map((id) => {
        const record = names[id];
        return (
          <span
            key={id}
            className="link-chip"
            data-private={!record || undefined}
            data-archived={record?.archived || undefined}
            title={record?.archived ? `${record.name} (archived)` : undefined}
          >
            <Link2 size={11} aria-hidden="true" />
            {record?.name ?? "Private item"}
            {record && !disabled && (
              <button
                type="button"
                aria-label={`Unlink ${record.name}`}
                onClick={() => onChange(value.filter((item) => item !== id))}
              >
                <X size={11} />
              </button>
            )}
          </span>
        );
      })}
      {!disabled && (many || value.length === 0) && (
        <Popover.Root open={open} onOpenChange={setOpen}>
          <Popover.Trigger className="link-add" aria-label={`Link ${label}`}>
            <Plus size={12} />
            Link
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              className="link-popover"
              align="start"
              sideOffset={6}
            >
              <input
                autoFocus
                aria-label={`Search records to link to ${label}`}
                placeholder="Search by name"
                value={q}
                onChange={(event) => setQ(event.target.value)}
              />
              <ul role="listbox" aria-label="Records to link">
                {options.isPending && <li className="link-empty">Loading…</li>}
                {options.error && (
                  <li className="link-empty" role="alert">
                    {options.error.message}
                  </li>
                )}
                {options.data
                  ?.filter((option) => !value.includes(option.id))
                  .map((option) => (
                    <li key={option.id}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={false}
                        onClick={() => {
                          setPicked({
                            ...picked,
                            [option.id]: {
                              name: option.name,
                              boardId: "",
                              archived: false,
                            },
                          });
                          onChange(many ? [...value, option.id] : [option.id]);
                          setOpen(false);
                          setQ("");
                        }}
                      >
                        {option.name}
                      </button>
                    </li>
                  ))}
                {options.data &&
                  !options.data.some(
                    (option) => !value.includes(option.id),
                  ) && (
                    <li className="link-empty">
                      {q ? "Nothing matches." : "Nothing left to link."}
                    </li>
                  )}
              </ul>
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
      )}
    </div>
  );
}
