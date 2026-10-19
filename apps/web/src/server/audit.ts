import { createRecordId, type DatabaseTransaction } from "@yuzu/database";

type Writer = Pick<DatabaseTransaction, "accessEvent" | "auditEvent">;

export type AuditInput = {
  actorId: string | null;
  action: string;
  /** A name or email, kept as text so the entry reads the same later. */
  subject: string;
  subjectId?: string | null;
  workspaceId?: string | null;
  details?: string | null;
};

/** Adds one entry to the installation's audit log. */
export function audit(
  tx: Pick<DatabaseTransaction, "auditEvent">,
  input: AuditInput,
) {
  return tx.auditEvent.create({ data: { id: createRecordId(), ...input } });
}

/** Workspace access changes keep their own record and join the audit log. */
export async function recordAccess(
  tx: Writer,
  data: {
    workspaceId: string;
    actorId: string;
    action: string;
    subjectEmail: string;
  },
) {
  await tx.accessEvent.create({ data });
  await audit(tx, {
    actorId: data.actorId,
    action: data.action,
    subject: data.subjectEmail,
    workspaceId: data.workspaceId,
  });
}
