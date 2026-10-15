import { ApiError, apiRequest } from "./api-client";
import { sameApprovalValue } from "./approval-rules";
import {
  boardStateSchema,
  type BoardTask,
  type FieldValue,
} from "./board-contract";

export type TaskDraft = Pick<
  BoardTask,
  | "name"
  | "description"
  | "checklist"
  | "statusId"
  | "priority"
  | "dueDate"
  | "groupId"
  | "assigneeIds"
  | "fieldValues"
>;
export type TaskChanges = Partial<TaskDraft>;
const scalarKeys = [
  "name",
  "description",
  "checklist",
  "statusId",
  "priority",
  "dueDate",
  "groupId",
  "assigneeIds",
] as const;
const same = sameApprovalValue;

export function taskDraft(task: BoardTask): TaskDraft {
  return Object.fromEntries(
    ([...scalarKeys, "fieldValues"] as const).map((key) => [key, task[key]]),
  ) as TaskDraft;
}

// The first edit to an untouched field starts from the version currently visible.
// Already-dirty fields retain their baseline so genuine conflicts stay detectable.
export function editTaskDraft(
  base: TaskDraft,
  local: TaskDraft,
  latest: TaskDraft,
  patch: TaskChanges,
) {
  const baseline = { ...base, fieldValues: { ...base.fieldValues } };
  for (const key of scalarKeys) {
    if (key in patch && same(local[key], base[key]))
      Object.assign(baseline, { [key]: latest[key] });
  }
  for (const key of Object.keys(patch.fieldValues ?? {})) {
    if (same(local.fieldValues[key], base.fieldValues[key]))
      baseline.fieldValues[key] = latest.fieldValues[key] ?? null;
  }
  return {
    baseline,
    local: {
      ...local,
      ...patch,
      fieldValues: { ...local.fieldValues, ...patch.fieldValues },
    },
  };
}

// Merge untouched values from the server without discarding local edits.
// Custom fields are compared individually, rather than replacing their whole map.
export function reconcileTaskDraft(
  base: TaskDraft,
  local: TaskDraft,
  latest: TaskDraft,
) {
  const draft = { ...latest, fieldValues: { ...latest.fieldValues } };
  const changes: TaskChanges = {};
  const conflicts: string[] = [];
  for (const key of scalarKeys) {
    if (same(local[key], base[key])) continue;
    Object.assign(draft, { [key]: local[key] });
    if (same(local[key], latest[key])) continue;
    Object.assign(changes, { [key]: local[key] });
    if (!same(base[key], latest[key])) conflicts.push(key);
  }
  const fieldChanges: Record<string, FieldValue> = {};
  for (const key of new Set([
    ...Object.keys(base.fieldValues),
    ...Object.keys(local.fieldValues),
  ])) {
    if (same(local.fieldValues[key], base.fieldValues[key])) continue;
    const value = local.fieldValues[key] ?? null;
    draft.fieldValues[key] = value;
    if (same(value, latest.fieldValues[key])) continue;
    fieldChanges[key] = value;
    if (!same(base.fieldValues[key], latest.fieldValues[key]))
      conflicts.push(`field:${key}`);
  }
  if (Object.keys(fieldChanges).length) changes.fieldValues = fieldChanges;
  return { draft, changes, conflicts };
}

export async function readBoardState(boardId: string, signal?: AbortSignal) {
  const response = await apiRequest(`/api/v1/boards/state?boardId=${boardId}`, {
    signal,
    cache: "no-store",
  });
  const parsed = boardStateSchema.safeParse(response.data);
  if (!parsed.success)
    throw new Error(
      "Board data could not be read. Try opening the board again.",
    );
  return parsed.data;
}

export async function saveTaskUpdate(
  boardId: string,
  input: {
    taskId: string;
    revision: number;
    changes: TaskChanges;
    requestKey?: string;
  },
  base: BoardTask,
) {
  input = { ...input, requestKey: input.requestKey ?? crypto.randomUUID() };
  try {
    return await apiRequest("/api/v1/boards/update", {
      method: "POST",
      json: input,
    });
  } catch (error) {
    if (!(error instanceof ApiError) || error.code !== "TASK_CHANGED")
      throw error;
    const latest = (await readBoardState(boardId)).tasks.find(
      (task) => task.id === input.taskId,
    );
    if (!latest || latest.archivedAt || !latest.canEdit) throw error;
    const original = taskDraft(base);
    const local = {
      ...original,
      ...input.changes,
      fieldValues: { ...original.fieldValues, ...input.changes.fieldValues },
    };
    const merged = reconcileTaskDraft(original, local, taskDraft(latest));
    if (merged.conflicts.length)
      throw new ApiError(
        409,
        "TASK_CHANGED",
        "Someone changed the same fields. Review the latest task before saving.",
      );
    if (!Object.keys(merged.changes).length)
      return {
        data: {
          outcome: "APPLIED",
          taskId: latest.id,
          revision: latest.revision,
        },
        requestId: "already-current",
      };
    // Retry once only, preserving revision checks and all server-side permissions.
    return apiRequest("/api/v1/boards/update", {
      method: "POST",
      json: { ...input, revision: latest.revision, changes: merged.changes },
    });
  }
}
