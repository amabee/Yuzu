import { createRecordId, type DatabaseTransaction } from "@yuzu/database";

// The inbox record is also the durable delivery intent. Socket events only hint
// that it changed; disconnected clients read these same committed records later.
export async function createNotifications(
  tx: DatabaseTransaction,
  input: {
    recipientIds: string[];
    actorId: string;
    boardId: string;
    taskId?: string | null;
    proposalId?: string;
    kind:
      | "ASSIGNMENT"
      | "APPROVAL_REQUEST"
      | "APPROVAL_DECISION"
      | "MENTION"
      | "AUTOMATION";
    message: string;
    eventKey: string;
    /** Automation acts as its creator but may still notify them. */
    includeActor?: boolean;
  },
) {
  const { recipientIds, includeActor, ...data } = input;
  const recipients = [...new Set(recipientIds)].filter(
    (id) => includeActor || id !== input.actorId,
  );
  if (recipients.length)
    await tx.notification.createMany({
      data: recipients.map((recipientId) => ({
        id: createRecordId(),
        ...data,
        recipientId,
      })),
      skipDuplicates: true,
    });
}
