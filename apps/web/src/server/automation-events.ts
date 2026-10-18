import type { DatabaseTransaction } from "@yuzu/database";
import { createRecordId } from "@yuzu/database";
import type { RuleTask } from "@/lib/automation-engine";

/** Where a change came from when a rule made it, for loop protection. */
export type AutomationContext = { depth: number; chain: string[] };

const pick = (task: Record<string, unknown>): RuleTask => ({
  statusId: (task.statusId as string | null) ?? null,
  priority: String(task.priority ?? "NORMAL"),
  groupId: (task.groupId as string | null) ?? null,
  assigneeIds: (task.assigneeIds as string[]) ?? [],
  startDate: (task.startDate as string | null) ?? null,
  dueDate: (task.dueDate as string | null) ?? null,
  fieldValues: (task.fieldValues as RuleTask["fieldValues"]) ?? {},
  checklist: Array.isArray(task.checklist)
    ? {
        done: (task.checklist as { done?: boolean }[]).filter(
          (item) => item.done,
        ).length,
        total: task.checklist.length,
      }
    : undefined,
});

/**
 * Queues a task change for automation in the same transaction as the change.
 * Boards without an enabled rule skip it, so bulk imports stay cheap.
 */
export async function recordAutomationEvent(
  tx: DatabaseTransaction,
  input: {
    boardId: string;
    taskId: string;
    kind: "task.created" | "task.changed" | "comment.added";
    /** People a new comment mentions. */
    mentions?: string[];
    before?: Record<string, unknown>;
    after: Record<string, unknown>;
    actorId: string;
    automation?: AutomationContext;
  },
) {
  const rules = await tx.automationRule.count({
    where: { boardId: input.boardId, enabled: true },
  });
  if (!rules) return;
  await tx.automationEvent.create({
    data: {
      id: createRecordId(),
      boardId: input.boardId,
      taskId: input.taskId,
      kind: input.kind,
      payload: {
        ...(input.before ? { before: pick(input.before) } : {}),
        after: pick(input.after),
        ...(input.mentions ? { mentions: input.mentions } : {}),
      },
      actorId: input.actorId,
      depth: input.automation?.depth ?? 0,
      chain: input.automation?.chain ?? [],
    },
  });
}
