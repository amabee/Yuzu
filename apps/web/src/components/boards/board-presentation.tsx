"use client";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from "@/components/ui/tooltip";
import { Avatar as AvatarPrimitive } from "radix-ui";
import {
  Circle,
  CircleDot,
  Clock,
  CheckCircle2,
  RotateCcw,
  Ban,
  Flag,
  CircleAlert,
} from "lucide-react";
import {
  priorities,
  type BoardState,
  type BoardOption,
} from "@/lib/board-contract";
export function StatusIcon({
  icon,
  size = 14,
}: {
  icon?: BoardOption["icon"];
  size?: number;
}) {
  const icons = {
    circle: Circle,
    "circle-dot": CircleDot,
    clock: Clock,
    "check-circle": CheckCircle2,
    "rotate-ccw": RotateCcw,
    ban: Ban,
    flag: Flag,
    "alert-circle": CircleAlert,
  };
  const Icon = icons[icon ?? "circle"];
  return <Icon size={size} aria-hidden="true" />;
}
export function optionBadgeStyle(option?: BoardOption) {
  if (!option?.color) return undefined;
  const rgb = option.color
    .slice(1)
    .match(/.{2}/g)!
    .map((hex) => parseInt(hex, 16) / 255)
    .map((n) => (n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4));
  const luminance = rgb[0]! * 0.2126 + rgb[1]! * 0.7152 + rgb[2]! * 0.0722;
  return {
    backgroundColor: option.color,
    borderColor: option.color,
    color: luminance > 0.179 ? "#000000" : "#ffffff",
  };
}
export function formatDueDate(value: string, year = false) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    ...(year ? { year: "numeric" } : {}),
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`));
}
export function priorityOptions(state: BoardState): BoardOption[] {
  const saved =
    state.fields.find((field) => field.key === "priority")?.options ?? [];
  return priorities.map(
    (id) =>
      saved.find((option) => option.id === id) ?? {
        id,
        label: id.charAt(0) + id.slice(1).toLowerCase(),
      },
  );
}

export function AssigneeAvatars({
  ids,
  people,
}: {
  ids: string[];
  people: BoardState["people"];
}) {
  if (!ids.length)
    return <span className="text-muted-foreground">Unassigned</span>;
  return (
    <TooltipProvider delayDuration={200}>
      <div className="task-assignees" aria-label="Assignees">
        {ids.slice(0, 3).map((id) => {
          const person = people.find((item) => item.id === id);
          const name = person?.name ?? "Former member";
          return (
            <Tooltip key={id}>
              <TooltipTrigger asChild>
                <AvatarPrimitive.Root
                  tabIndex={0}
                  role="img"
                  className="task-avatar"
                  aria-label={name}
                >
                  {person?.image && (
                    <AvatarPrimitive.Image src={person.image} alt="" />
                  )}
                  <AvatarPrimitive.Fallback>
                    {name
                      .trim()
                      .split(/\s+/)
                      .slice(0, 2)
                      .map((part) => part[0])
                      .join("")
                      .toUpperCase()}
                  </AvatarPrimitive.Fallback>
                </AvatarPrimitive.Root>
              </TooltipTrigger>
              <TooltipContent>{name}</TooltipContent>
            </Tooltip>
          );
        })}
        {ids.length > 3 && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                className="task-avatar"
                tabIndex={0}
                aria-label={`${ids.length - 3} more assignees`}
              >
                +{ids.length - 3}
              </span>
            </TooltipTrigger>
            <TooltipContent className="max-w-64">
              {ids
                .slice(3)
                .map(
                  (id) =>
                    people.find((person) => person.id === id)?.name ??
                    "Former member",
                )
                .join(", ")}
            </TooltipContent>
          </Tooltip>
        )}
      </div>
    </TooltipProvider>
  );
}
