import type { ApprovalPolicy, ApprovalOperation } from "./approval-contract";
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`)
      .join(",")}}`;
  return JSON.stringify(value ?? null);
}
const comparableValue = (value: unknown) =>
  Array.isArray(value)
    ? value.length
      ? [...value].sort()
      : null
    : value === ""
      ? null
      : (value ?? null);
export const sameApprovalValue = (a: unknown, b: unknown) =>
  stableJson(comparableValue(a)) === stableJson(comparableValue(b));

const fieldKeys: Record<string, string> = {
  name: "name",
  description: "description",
  statusId: "status",
  priority: "priority",
  startDate: "start_date",
  dueDate: "due_date",
  assigneeIds: "assignees",
};
export function affectedFieldIds(
  changes: Record<string, unknown>,
  fields: { id: string; key: string }[],
) {
  return [
    ...fields
      .filter((field) =>
        Object.keys(changes).some((key) => fieldKeys[key] === field.key),
      )
      .map((field) => field.id),
    ...Object.keys((changes.fieldValues as Record<string, unknown>) ?? {}),
  ];
}
export function needsApproval(
  policy: ApprovalPolicy,
  operation: ApprovalOperation,
  changes: Record<string, unknown>,
  fields: { id: string; key: string }[],
) {
  if (!policy.enabled) return false;
  if (operation === "CREATE") return policy.requireCreation;
  if (operation === "ARCHIVE") return policy.requireArchive;
  return (
    policy.requireChanges &&
    affectedFieldIds(changes, fields).some((id) =>
      policy.protectedFieldIds.includes(id),
    )
  );
}
export function compatiblePolicy(
  before: ApprovalPolicy,
  after: ApprovalPolicy,
  operation: ApprovalOperation,
  changes: Record<string, unknown>,
  fields: { id: string; key: string }[],
) {
  if (
    !needsApproval(before, operation, changes, fields) ||
    !needsApproval(after, operation, changes, fields)
  )
    return false;
  if (operation !== "UPDATE") return true;
  const affected = affectedFieldIds(changes, fields);
  return sameApprovalValue(
    before.protectedFieldIds.filter((id) => affected.includes(id)),
    after.protectedFieldIds.filter((id) => affected.includes(id)),
  );
}
export function approvalConflicts(
  baseline: Record<string, unknown>,
  latest: Record<string, unknown>,
  changes: Record<string, unknown>,
  operation: ApprovalOperation,
) {
  if (operation === "ARCHIVE")
    return sameApprovalValue(baseline.archivedAt, latest.archivedAt)
      ? []
      : ["archivedAt"];
  const conflicts = Object.keys(changes).filter(
    (key) =>
      key !== "fieldValues" && !sameApprovalValue(baseline[key], latest[key]),
  );
  const beforeFields = (baseline.fieldValues as Record<string, unknown>) ?? {};
  const latestFields = (latest.fieldValues as Record<string, unknown>) ?? {};
  for (const id of Object.keys(
    (changes.fieldValues as Record<string, unknown>) ?? {},
  ))
    if (!sameApprovalValue(beforeFields[id], latestFields[id]))
      conflicts.push(`field:${id}`);
  return conflicts;
}
export function eligibleReviewer(
  policy: ApprovalPolicy,
  authorId: string,
  eligible: Set<string>,
) {
  return (
    [policy.primaryApproverId, policy.backupApproverId].find(
      (id) => id && id !== authorId && eligible.has(id),
    ) ?? null
  );
}

export function actualApprovalChanges(
  baseline: Record<string, unknown>,
  changes: Record<string, unknown>,
) {
  const actual = Object.fromEntries(
    Object.entries(changes).filter(
      ([key, value]) =>
        key !== "fieldValues" && !sameApprovalValue(baseline[key], value),
    ),
  );
  const originalFields =
    (baseline.fieldValues as Record<string, unknown>) ?? {};
  const fields = Object.fromEntries(
    Object.entries(
      (changes.fieldValues as Record<string, unknown>) ?? {},
    ).filter(([id, value]) => !sameApprovalValue(originalFields[id], value)),
  );
  if (Object.keys(fields).length) actual.fieldValues = fields;
  return actual;
}
