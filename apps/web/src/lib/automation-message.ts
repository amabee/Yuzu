/** Placeholders a notify message can use, with what each becomes. */
export const messageFields = [
  { key: "parent", hint: "the parent task’s name (empty for tasks)" },
  { key: "task", hint: "the task's name" },
  { key: "status", hint: "its status" },
  { key: "priority", hint: "its priority" },
  { key: "due", hint: "its due date" },
  { key: "assignees", hint: "who it's assigned to" },
  { key: "creator", hint: "who created it" },
  { key: "board", hint: "the board" },
  { key: "rule", hint: "this rule's name" },
  { key: "date", hint: "today's date" },
] as const;
export type MessageField = (typeof messageFields)[number]["key"];

/**
 * Fills `{task}` or `${task}` style placeholders. Unknown names stay as
 * typed, so a typo shows up in the notification rather than vanishing.
 */
export function renderMessage(
  template: string,
  values: Partial<Record<MessageField, string>>,
) {
  return template
    .replace(/\$?\{\s*(\w+)\s*\}/g, (match, key: string) =>
      key in values ? (values[key as MessageField] ?? "") : match,
    )
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, 400);
}

/** The line a rule notification shows when no custom message was written. */
export const defaultMessage = (hasTask: boolean) =>
  hasTask ? "{task} was updated by “{rule}”." : "“{rule}” ran.";
