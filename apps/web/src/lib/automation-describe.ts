import type {
  AutomationAction,
  AutomationCondition,
  AutomationTrigger,
} from "./automation-contract";

/** Names the board knows things by, for turning a rule into a sentence. */
export type RuleLabels = {
  status: (id: string | null) => string;
  priority: (id: string) => string;
  group: (id: string | null) => string;
  person: (id: string) => string;
  field: (id: string) => string;
  option: (fieldId: string, id: string) => string;
};

/** A sentence part; `strong` parts are the values the rule picked. */
export type Part = { text: string; strong?: boolean };
const t = (text: string): Part => ({ text });
const b = (text: string): Part => ({ text, strong: true });

export function describeTrigger(
  trigger: AutomationTrigger,
  labels: RuleLabels,
): Part[] {
  switch (trigger.kind) {
    case "task.created":
      return [t("a task is "), b("created")];
    case "status.changed":
      return trigger.from
        ? [
            t("status changes from "),
            b(labels.status(trigger.from)),
            t(" to "),
            b(labels.status(trigger.to)),
          ]
        : [t("status changes to "), b(labels.status(trigger.to))];
    case "assignee.added":
      return trigger.userId
        ? [b(labels.person(trigger.userId)), t(" is assigned")]
        : [t("someone is "), b("assigned")];
    case "due.arrived":
      return [t("a task is "), b("due today")];
    case "due.overdue":
      return [t("a task becomes "), b("overdue")];
    case "field.changed":
      return trigger.field === "priority"
        ? [t("priority changes to "), b(labels.priority(trigger.value))]
        : trigger.field === "group"
          ? [t("a task moves to "), b(labels.group(trigger.value))]
          : [
              t(`${labels.field(trigger.field)} changes to `),
              b(labels.option(trigger.field, trigger.value)),
            ];
  }
}

export function describeCondition(
  condition: AutomationCondition,
  labels: RuleLabels,
): Part[] {
  switch (condition.subject) {
    case "status":
    case "priority":
    case "group": {
      const value =
        condition.subject === "status"
          ? labels.status(condition.value)
          : condition.subject === "priority"
            ? labels.priority(condition.value ?? "")
            : labels.group(condition.value);
      return [
        t(`${condition.subject} ${condition.op === "is" ? "is" : "is not"} `),
        b(value),
      ];
    }
    case "assignees":
      return condition.op === "empty"
        ? [t("nobody is "), b("assigned")]
        : [b(labels.person(condition.userId!)), t(" is assigned")];
    case "field":
      return typeof condition.value === "boolean"
        ? [
            b(labels.field(condition.fieldId)),
            t(
              ` is ${condition.value === (condition.op === "is") ? "checked" : "not checked"}`,
            ),
          ]
        : [
            t(
              `${labels.field(condition.fieldId)} ${condition.op === "is" ? "is" : "is not"} `,
            ),
            b(labels.option(condition.fieldId, condition.value)),
          ];
    case "due":
      return condition.op === "set"
        ? [t("it has a "), b("due date")]
        : [t("it has "), b("no due date")];
  }
}

function days(count: number | null) {
  if (count === null) return "cleared";
  if (count === 0) return "today";
  if (count === 1) return "tomorrow";
  if (count === -1) return "yesterday";
  return count > 0 ? `in ${count} days` : `${-count} days ago`;
}

export function describeAction(
  action: AutomationAction,
  labels: RuleLabels,
): Part[] {
  switch (action.kind) {
    case "set.status":
      return [b(`set status to ${labels.status(action.value)}`)];
    case "set.priority":
      return [b(`set priority to ${labels.priority(action.value)}`)];
    case "set.group":
      return [b(`move to ${labels.group(action.value)}`)];
    case "assign":
      return [b(`assign ${labels.person(action.userId)}`)];
    case "unassign":
      return [b(`unassign ${labels.person(action.userId)}`)];
    case "set.field": {
      const name = labels.field(action.fieldId);
      const value = action.value;
      return [
        b(
          value === null
            ? `clear ${name}`
            : typeof value === "boolean"
              ? `${value ? "check" : "uncheck"} ${name}`
              : `set ${name} to ${(Array.isArray(value) ? value : [value])
                  .map((id) => labels.option(action.fieldId, id))
                  .join(", ")}`,
        ),
      ];
    }
    case "set.date": {
      const name =
        action.field === "dueDate"
          ? "due date"
          : action.field === "startDate"
            ? "start date"
            : labels.field(action.field);
      return [
        b(
          action.days === null
            ? `clear the ${name}`
            : `set the ${name} to ${days(action.days)}`,
        ),
      ];
    }
    case "notify":
      return [
        b(
          action.to === "assignees"
            ? "notify the assignees"
            : action.to === "creator"
              ? "notify the creator"
              : `notify ${(action.userIds ?? []).map(labels.person).join(", ")}`,
        ),
      ];
  }
}

/** "When …, if … and …, then … and …." as sentence parts. */
export function describeRule(
  rule: {
    trigger: AutomationTrigger;
    conditions: AutomationCondition[];
    actions: AutomationAction[];
  },
  labels: RuleLabels,
): Part[] {
  const join = (groups: Part[][]) =>
    groups.flatMap((group, index) => [
      ...(index === 0 ? [] : [t(index === groups.length - 1 ? " and " : ", ")]),
      ...group,
    ]);
  return [
    t("When "),
    ...describeTrigger(rule.trigger, labels),
    ...(rule.conditions.length
      ? [
          t(", if "),
          ...join(
            rule.conditions.map((condition) =>
              describeCondition(condition, labels),
            ),
          ),
        ]
      : []),
    t(", then "),
    ...join(rule.actions.map((action) => describeAction(action, labels))),
    t("."),
  ];
}
