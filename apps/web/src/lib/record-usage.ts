import type { BuiltinKey, RecordConfig } from "./record-types";

type RuleShape = {
  trigger: { kind: string; field?: unknown };
  conditions: { subject: string }[];
  actions: { kind: string; field?: unknown }[];
};
type ViewShape = {
  statusId?: string | null;
  priority?: string;
  assignee?: string;
  due?: string;
  sort?: string;
  timeline?: { groupBy?: string };
};

/** The built-ins a board rule depends on. */
export function ruleBuiltins(rule: RuleShape): Set<BuiltinKey> {
  const used = new Set<BuiltinKey>();
  const { trigger } = rule;
  if (trigger.kind === "status.changed") used.add("status");
  if (trigger.kind === "assignee.added") used.add("assignees");
  if (trigger.kind === "due.arrived" || trigger.kind === "due.overdue")
    used.add("dueDate");
  if (trigger.kind === "checklist.completed") used.add("checklist");
  if (trigger.kind === "field.changed" && trigger.field === "priority")
    used.add("priority");
  for (const condition of rule.conditions) {
    if (condition.subject === "status") used.add("status");
    if (condition.subject === "priority") used.add("priority");
    if (condition.subject === "assignees") used.add("assignees");
    if (condition.subject === "due") used.add("dueDate");
  }
  for (const action of rule.actions) {
    if (action.kind === "set.status") used.add("status");
    if (action.kind === "set.priority") used.add("priority");
    if (action.kind === "assign" || action.kind === "unassign")
      used.add("assignees");
    if (action.kind === "set.date" && action.field === "dueDate")
      used.add("dueDate");
    if (action.kind === "set.date" && action.field === "startDate")
      used.add("startDate");
  }
  return used;
}

/** The built-ins a saved view filters, sorts or groups by. */
export function viewBuiltins(view: ViewShape): Set<BuiltinKey> {
  const used = new Set<BuiltinKey>();
  if (view.statusId) used.add("status");
  if (view.priority && view.priority !== "all") used.add("priority");
  if (view.assignee && view.assignee !== "all") used.add("assignees");
  if ((view.due && view.due !== "all") || view.sort === "due")
    used.add("dueDate");
  if (view.timeline?.groupBy === "status") used.add("status");
  if (view.timeline?.groupBy === "assignee") used.add("assignees");
  return used;
}

/** The first turned-off built-in a rule needs, if any. */
export function ruleBlockedBy(rule: RuleShape, config: RecordConfig) {
  return [...ruleBuiltins(rule)].find((key) => !config.builtins[key].on);
}
