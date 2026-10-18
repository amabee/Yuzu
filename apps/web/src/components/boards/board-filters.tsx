"use client";

import { useId, type ReactNode } from "react";
import { Search, SlidersHorizontal, X } from "lucide-react";
import {
  Select,
  SelectValue,
  SelectTrigger,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { type BoardOption } from "@/lib/board-contract";
import { type ViewConfig } from "@/lib/saved-view-contract";

type Choice = { value: string; label: string; decoration?: ReactNode };
export function BoardFilterSelect({
  label,
  title,
  value,
  onChange,
  options,
  className,
}: {
  label: string;
  title?: string;
  value: string;
  onChange: (value: string) => void;
  options: Choice[];
  className?: string;
}) {
  const id = useId();
  return (
    <div className={className ?? "min-w-0"}>
      {title && (
        <label
          htmlFor={id}
          className="mb-2 block text-xs font-medium text-muted-foreground"
        >
          {title}
        </label>
      )}
      <Select
        value={value || "__all__"}
        onValueChange={(value) => onChange(value === "__all__" ? "" : value)}
      >
        <SelectTrigger id={id} aria-label={label} data-value={value}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem
              key={option.value}
              value={option.value || "__all__"}
              data-value={option.value}
              textValue={option.label}
            >
              <span className="flex min-w-0 items-center gap-2.5">
                {option.decoration && (
                  <span aria-hidden="true">{option.decoration}</span>
                )}
                <span
                  data-option-label
                  className="min-w-0 whitespace-normal break-words"
                >
                  {option.label}
                </span>
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export function BoardFilters({
  config,
  statuses,
  priorities,
  groupActive,
  count,
  onChange,
  hideDue = false,
}: {
  config: ViewConfig;
  statuses: BoardOption[];
  priorities: BoardOption[];
  groupActive: boolean;
  count: number;
  onChange: (config: ViewConfig) => void;
  /** The calendar places tasks by date, so it hides the due-date filter. */
  hideDue?: boolean;
}) {
  const searchId = useId();
  const active = [
    Boolean(config.statusId),
    Boolean(config.search),
    groupActive,
    config.assignee !== "all",
    config.priority !== "all",
    config.due !== "all",
  ].filter(Boolean).length;
  const field = <K extends keyof ViewConfig>(key: K, value: ViewConfig[K]) =>
    onChange({ ...config, [key]: value });
  const dot = (color?: string) =>
    color ? (
      <span
        className="block size-2 rounded-full"
        style={{ backgroundColor: color }}
      />
    ) : undefined;
  return (
    <section
      aria-label="Task filters"
      className="mb-4 rounded-lg border border-border bg-card p-4 sm:p-5"
    >
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <SlidersHorizontal size={16} className="text-muted-foreground" />
          <h2 className="text-sm font-semibold">Filter tasks</h2>
          <span className="text-xs text-muted-foreground">
            {count} {count === 1 ? "match" : "matches"}
          </span>
        </div>
        {active > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() =>
              onChange({
                ...config,
                search: "",
                groupId: null,
                statusId: null,
                assignee: "all",
                priority: "all",
                due: "all",
              })
            }
          >
            <X size={13} />
            Clear filters
            <span className="rounded bg-muted px-1.5 text-xs text-muted-foreground">
              {active}
            </span>
          </Button>
        )}
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="min-w-0 sm:col-span-2">
          <label
            htmlFor={searchId}
            className="mb-2 block text-xs font-medium text-muted-foreground"
          >
            Search
          </label>
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id={searchId}
              aria-label="Search tasks"
              placeholder="Search task names or descriptions…"
              className="h-[40px] pl-9"
              value={config.search}
              maxLength={200}
              onChange={(event) => field("search", event.target.value)}
            />
          </div>
        </div>
        <BoardFilterSelect
          title="Status"
          label="Filter board status"
          value={config.statusId ?? ""}
          onChange={(value) => field("statusId", value || null)}
          options={[
            { value: "", label: "All statuses" },
            ...(config.statusId &&
            config.statusId !== "__none__" &&
            !statuses.some((status) => status.id === config.statusId)
              ? [{ value: config.statusId, label: "Removed status" }]
              : []),
            ...statuses.map((status) => ({
              value: status.id,
              label: status.label,
              decoration: dot(status.color),
            })),
            { value: "__none__", label: "No status" },
          ]}
        />
        <BoardFilterSelect
          title="Assignee"
          label="Filter task assignee"
          value={config.assignee}
          onChange={(value) =>
            field("assignee", value as ViewConfig["assignee"])
          }
          options={[
            { value: "all", label: "Anyone" },
            { value: "me", label: "Assigned to me" },
            { value: "unassigned", label: "Unassigned" },
          ]}
        />
        <BoardFilterSelect
          title="Priority"
          label="Filter task priority"
          value={config.priority}
          onChange={(value) =>
            field("priority", value as ViewConfig["priority"])
          }
          options={[
            { value: "all", label: "Any priority" },
            ...priorities.map((option) => ({
              value: option.id,
              label: option.label,
              decoration: dot(option.color),
            })),
          ]}
        />
        {!hideDue && (
          <BoardFilterSelect
            title="Due date"
            label="Filter task due date"
            value={config.due}
            onChange={(value) => field("due", value as ViewConfig["due"])}
            options={[
              { value: "all", label: "Any date" },
              { value: "overdue", label: "Overdue" },
              { value: "next-week", label: "Next 7 days" },
              { value: "none", label: "No due date" },
            ]}
          />
        )}
        <BoardFilterSelect
          className="min-w-0 sm:col-span-2"
          title="Sort by"
          label="Sort tasks"
          value={config.sort}
          onChange={(value) => field("sort", value as ViewConfig["sort"])}
          options={[
            { value: "created", label: "Created order" },
            { value: "name", label: "Name" },
            { value: "due", label: "Due date" },
          ]}
        />
      </div>
    </section>
  );
}
