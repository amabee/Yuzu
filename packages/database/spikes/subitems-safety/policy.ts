import { compatiblePolicy } from "../../../../apps/web/src/lib/approval-rules.js";

/** Spike only: no production service imports this module. Scope must come from
 * current server authorization; caller-supplied flags are never authorization. */
export type Scope = {
  boardId: string;
  recordType: "TASK" | "DEAL" | "CUSTOM";
  principalId: string;
  authorized: boolean;
  active: boolean;
  canManage: boolean;
  maintenance: boolean;
  readOnly: boolean;
};
export type Task = {
  id: string;
  boardId: string;
  parentId: string | null;
  groupId: string | null;
  createdById: string;
  assigneeIds: string[];
  editorIds: string[];
  archivedAt: Date | null;
  deletedAt: Date | null;
};
export class SafetyError extends Error {
  constructor(public code: string) {
    super(
      code === "CAPACITY"
        ? "Subitem capacity reached. Ask a board manager to review the breakdown."
        : code === "UNAVAILABLE"
          ? "This task is unavailable."
          : code === "STALE"
            ? "This request changed. Review and submit again."
            : "This operation is not available.",
    );
  }
}
const edits = (task: Task, principalId: string) =>
  task.createdById === principalId ||
  task.assigneeIds.includes(principalId) ||
  task.editorIds.includes(principalId);

export function taskSafety(
  scope: Scope,
  task: Task,
  parent: Task | null = null,
) {
  const parentValid =
    !task.parentId ||
    Boolean(
      scope.recordType === "TASK" &&
      parent &&
      parent.id === task.parentId &&
      parent.boardId === task.boardId &&
      !parent.parentId &&
      !parent.deletedAt,
    );
  const available =
    scope.authorized &&
    scope.active &&
    task.boardId === scope.boardId &&
    !task.deletedAt &&
    parentValid;
  const archived = Boolean(
    scope.readOnly || task.archivedAt || (task.parentId && parent?.archivedAt),
  );
  const frozen = scope.readOnly || archived;
  const writable = Boolean(available && !frozen && !scope.maintenance);
  const canEdit = Boolean(
    writable &&
    (scope.canManage ||
      edits(task, scope.principalId) ||
      (task.parentId && parent && edits(parent, scope.principalId))),
  );
  return {
    available: Boolean(available),
    readOnly: !available || frozen || scope.maintenance,
    archived: Boolean(available && archived),
    effectiveGroupId: available
      ? task.parentId
        ? parent!.groupId
        : task.groupId
      : null,
    canEdit,
    canCreateChild: Boolean(
      canEdit && !task.parentId && scope.recordType === "TASK",
    ),
    canManageEditors: Boolean(writable && scope.canManage),
    canRestore: Boolean(
      available &&
      scope.canManage &&
      !scope.readOnly &&
      !scope.maintenance &&
      !(task.parentId && parent?.archivedAt),
    ),
  };
}
export function assertCanAdd(scope: Scope, parent: Task) {
  const safety = taskSafety(scope, parent);
  if (!safety.available) throw new SafetyError("UNAVAILABLE");
  if (!safety.canCreateChild) throw new SafetyError("FORBIDDEN");
}
export function assertChildShape(
  child: Task,
  parent: Task,
  recordType: Scope["recordType"],
) {
  if (
    recordType !== "TASK" ||
    child.parentId !== parent.id ||
    child.id === parent.id ||
    parent.parentId ||
    child.boardId !== parent.boardId ||
    child.groupId !== null
  )
    throw new SafetyError("INVALID_PARENT");
}
export function assertReservationRoom(
  accepted: number,
  pending: number,
  limit = 200,
  applyingReservation = false,
) {
  if (
    !Number.isInteger(accepted) ||
    !Number.isInteger(pending) ||
    accepted < 0 ||
    pending < 0 ||
    limit < 1 ||
    accepted + pending + (applyingReservation ? 0 : 1) > limit
  )
    throw new SafetyError("CAPACITY");
}
export type CreationProposal = {
  authorId: string;
  boardId: string;
  parentTaskId: string;
  payloadParentId: string;
  status: string;
  policyVersion: number;
};
export function assertCreationApply(
  proposal: CreationProposal,
  parent: Task,
  author: Scope,
  reviewer: Scope,
  currentPolicyVersion: number,
  currentReviewerId: string,
  currentCreationRequired = true,
) {
  if (author.maintenance || reviewer.maintenance)
    throw new SafetyError("MAINTENANCE");
  if (
    !reviewer.authorized ||
    !reviewer.active ||
    reviewer.boardId !== proposal.boardId ||
    reviewer.principalId !== currentReviewerId ||
    reviewer.principalId === proposal.authorId ||
    reviewer.maintenance ||
    reviewer.readOnly
  )
    throw new SafetyError("FORBIDDEN");
  if (proposal.status !== "PENDING") throw new SafetyError("ALREADY_RESOLVED");
  if (
    proposal.authorId !== author.principalId ||
    proposal.boardId !== author.boardId ||
    proposal.parentTaskId !== proposal.payloadParentId ||
    proposal.parentTaskId !== parent.id ||
    !compatiblePolicy(
      creationPolicy(proposal.policyVersion, true, currentReviewerId),
      creationPolicy(
        currentPolicyVersion,
        currentCreationRequired,
        currentReviewerId,
      ),
      "CREATE",
      {},
      [],
    )
  )
    throw new SafetyError("STALE");
  try {
    assertCanAdd(author, parent);
  } catch {
    throw new SafetyError("STALE");
  }
}

// The spike varies the CREATE-relevant policy bit. Production retains the full
// policySnapshot already stored by submitProposal; do not replace that snapshot.
function creationPolicy(
  version: number,
  requireCreation: boolean,
  reviewerId: string,
) {
  return {
    version,
    enabled: true,
    requireCreation,
    requireChanges: true,
    requireArchive: false,
    protectedFieldIds: [],
    primaryApproverId: reviewerId,
    backupApproverId: null,
  };
}
