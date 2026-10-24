import { test } from "node:test";
import assert from "node:assert/strict";
import { createRecordId } from "../../src/ids.js";
import { createTaskSchema } from "../../../../apps/web/src/lib/board-contract.js";
import {
  approvalConflicts,
  needsApproval,
  eligibleReviewer,
} from "../../../../apps/web/src/lib/approval-rules.js";
import {
  assertCanAdd,
  assertChildShape,
  assertCreationApply,
  assertReservationRoom,
  SafetyError,
  taskSafety,
  type Scope,
  type Task,
  type CreationProposal,
} from "./policy.js";

const boardId = createRecordId(),
  parentId = createRecordId(),
  childId = createRecordId();
const scope = (extra: Partial<Scope> = {}): Scope => ({
  boardId,
  recordType: "TASK",
  principalId: "parent-editor",
  authorized: true,
  active: true,
  canManage: false,
  maintenance: false,
  readOnly: false,
  ...extra,
});
const root = (extra: Partial<Task> = {}): Task => ({
  id: parentId,
  boardId,
  parentId: null,
  groupId: "group-a",
  createdById: "parent-owner",
  assigneeIds: [],
  editorIds: ["parent-editor"],
  archivedAt: null,
  deletedAt: null,
  ...extra,
});
const child = (extra: Partial<Task> = {}): Task => ({
  ...root(),
  id: childId,
  parentId,
  groupId: null,
  createdById: "child-owner",
  editorIds: [],
  assigneeIds: ["child-assignee"],
  ...extra,
});
const proposal = (extra: Partial<CreationProposal> = {}): CreationProposal => ({
  boardId,
  authorId: "parent-editor",
  parentTaskId: parentId,
  payloadParentId: parentId,
  policyVersion: 1,
  status: "PENDING",
  ...extra,
});
const reviewer = () => scope({ principalId: "reviewer" });
const hasCode = (code: string) => (error: unknown) =>
  error instanceof SafetyError && error.code === code;

test("parent editors inherit editing authority without copying grants", () => {
  assert.equal(taskSafety(scope(), child(), root()).canEdit, true);
  assert.equal(
    taskSafety(scope(), child(), root({ editorIds: [] })).canEdit,
    false,
  );
  assert.deepEqual(child().editorIds, []);
  assert.equal(
    taskSafety(scope({ principalId: "parent-owner" }), child(), root()).canEdit,
    true,
  );
  assert.equal(
    taskSafety(
      scope({ principalId: "parent-assignee" }),
      child(),
      root({ assigneeIds: ["parent-assignee"] }),
    ).canEdit,
    true,
  );
});
test("child assignees edit only their child and cannot create siblings or grant editors", () => {
  const person = scope({ principalId: "child-assignee" });
  assert.equal(taskSafety(person, child(), root()).canEdit, true);
  assert.equal(taskSafety(person, root()).canEdit, false);
  assert.equal(
    taskSafety(person, child({ assigneeIds: [] }), root()).canEdit,
    false,
  );
  assert.throws(() => assertCanAdd(person, root()), hasCode("FORBIDDEN"));
  assert.equal(taskSafety(scope(), child(), root()).canManageEditors, false);
});
test("manager power still requires current board access and active identity", () => {
  for (const changed of [
    { authorized: false },
    { active: false },
    { boardId: createRecordId() },
  ]) {
    const result = taskSafety(
      scope({ canManage: true, ...changed }),
      child(),
      root(),
    );
    assert.equal(result.available, false);
    assert.equal(result.canEdit, false);
    assert.equal(result.effectiveGroupId, null);
  }
});
test("own, ancestor and container archives prevent inherited and direct editing", () => {
  for (const [context, item, parent] of [
    [scope(), child({ archivedAt: new Date() }), root()],
    [scope(), child(), root({ archivedAt: new Date() })],
    [scope({ readOnly: true }), child(), root()],
  ] as const) {
    const access = taskSafety(context, item, parent);
    assert.equal(access.available, true);
    assert.equal(access.archived, true);
    assert.equal(access.canEdit, false);
    assert.equal(access.readOnly, true);
  }
});
test("Trash and missing or mismatched ancestors are unavailable without group disclosure", () => {
  for (const parent of [
    null,
    root({ deletedAt: new Date() }),
    root({ id: createRecordId() }),
    root({ boardId: createRecordId() }),
    root({ parentId: createRecordId() }),
  ]) {
    const result = taskSafety(scope(), child(), parent);
    assert.equal(result.available, false);
    assert.equal(result.effectiveGroupId, null);
  }
  assert.equal(
    taskSafety(scope(), child({ deletedAt: new Date() }), root()).available,
    false,
  );
});
test("parent archive inheritance does not mutate independent flags or permit child restoration", () => {
  const item = child({ archivedAt: new Date() });
  const saved = item.archivedAt;
  assert.equal(
    taskSafety(
      scope({ canManage: true }),
      item,
      root({ archivedAt: new Date() }),
    ).canRestore,
    false,
  );
  assert.equal(
    taskSafety(scope({ canManage: true }), item, root()).canRestore,
    true,
  );
  assert.equal(taskSafety(scope(), item, root()).canRestore, false);
  assert.equal(item.archivedAt, saved);
});
test("maintenance blocks writes and restores while leaving permitted reads intact", () => {
  const access = taskSafety(
    scope({ maintenance: true, canManage: true }),
    child(),
    root(),
  );
  assert.equal(access.available, true);
  assert.equal(access.canEdit, false);
  assert.equal(access.canRestore, false);
  assert.equal(
    taskSafety(scope({ maintenance: true }), root()).canCreateChild,
    false,
  );
});
test("effective group follows the parent even when the parent group is cleared", () => {
  assert.equal(
    taskSafety(scope(), child(), root()).effectiveGroupId,
    "group-a",
  );
  assert.equal(
    taskSafety(scope(), child(), root({ groupId: null })).effectiveGroupId,
    null,
  );
  assert.equal(child().groupId, null);
});
test("shape validation rejects cross-board, self, nested and group-owning children", () => {
  assert.doesNotThrow(() => assertChildShape(child(), root(), "TASK"));
  for (const [item, parent] of [
    [child({ boardId: createRecordId() }), root()],
    [child({ id: parentId }), root()],
    [child(), root({ parentId: createRecordId() })],
    [child({ groupId: "forged" }), root()],
  ] as const)
    assert.throws(
      () => assertChildShape(item, parent, "TASK"),
      hasCode("INVALID_PARENT"),
    );
  for (const type of ["DEAL", "CUSTOM"] as const)
    assert.throws(
      () => assertChildShape(child(), root(), type),
      hasCode("INVALID_PARENT"),
    );
});
test("cap includes retained records and pending slots; applying exchanges rather than adds a slot", () => {
  assert.doesNotThrow(() => assertReservationRoom(199, 0));
  assert.throws(() => assertReservationRoom(199, 1), hasCode("CAPACITY"));
  assert.doesNotThrow(() => assertReservationRoom(199, 1, 200, true));
  assert.throws(
    () => assertReservationRoom(200, 1, 200, true),
    hasCode("CAPACITY"),
  );
  assert.equal(new SafetyError("CAPACITY").message.includes("199"), false);
});
test("approval apply checks immutable parent, policy and requester authority", () => {
  assert.doesNotThrow(() =>
    assertCreationApply(proposal(), root(), scope(), reviewer(), 1, "reviewer"),
  );
  for (const pending of [
    proposal({ payloadParentId: createRecordId() }),
    proposal({ parentTaskId: createRecordId() }),
  ])
    assert.throws(
      () =>
        assertCreationApply(
          pending,
          root(),
          scope(),
          reviewer(),
          1,
          "reviewer",
        ),
      hasCode("STALE"),
    );
  for (const author of [
    scope({ authorized: false }),
    scope({ active: false }),
    scope({ principalId: "former-editor" }),
  ])
    assert.throws(
      () =>
        assertCreationApply(
          proposal(),
          root(),
          author,
          reviewer(),
          1,
          "reviewer",
        ),
      hasCode("STALE"),
    );
  assert.throws(
    () =>
      assertCreationApply(
        proposal(),
        root({ archivedAt: new Date() }),
        scope(),
        reviewer(),
        1,
        "reviewer",
      ),
    hasCode("STALE"),
  );
});
test("a reviewer cannot self-approve, act after revocation or apply a resolved proposal", () => {
  for (const person of [
    scope(),
    reviewerWith({ authorized: false }),
    reviewerWith({ active: false }),
    reviewerWith({ boardId: createRecordId() }),
    reviewerWith({ principalId: "old-reviewer" }),
    reviewerWith({ readOnly: true }),
  ])
    assert.throws(
      () =>
        assertCreationApply(proposal(), root(), scope(), person, 1, "reviewer"),
      hasCode("FORBIDDEN"),
    );
  assert.throws(
    () =>
      assertCreationApply(
        proposal({ status: "APPROVED" }),
        root(),
        scope(),
        reviewer(),
        1,
        "reviewer",
      ),
    hasCode("ALREADY_RESOLVED"),
  );
});
function reviewerWith(extra: Partial<Scope>) {
  return { ...reviewer(), ...extra };
}
test("maintenance aborts approval without making it stale", () => {
  assert.throws(
    () =>
      assertCreationApply(
        proposal(),
        root(),
        scope({ maintenance: true }),
        reviewer(),
        1,
        "reviewer",
      ),
    hasCode("MAINTENANCE"),
  );
});
test("existing field comparisons preserve unrelated edits and detect changes to requested fields", () => {
  const baseline = { name: "Old name", statusId: "todo", fieldValues: {} };
  assert.deepEqual(
    approvalConflicts(
      baseline,
      { ...baseline, name: "Fixed typo" },
      { statusId: "done" },
      "UPDATE",
    ),
    [],
  );
  assert.deepEqual(
    approvalConflicts(
      baseline,
      { ...baseline, statusId: "in_progress" },
      { statusId: "done" },
      "UPDATE",
    ),
    ["statusId"],
  );
});
test("existing approval helpers require protected creation/archive and route away from self", () => {
  const policy = {
    version: 1,
    enabled: true,
    requireCreation: true,
    requireChanges: true,
    requireArchive: true,
    protectedFieldIds: [],
    primaryApproverId: "author",
    backupApproverId: "reviewer",
  };
  assert.equal(needsApproval(policy, "CREATE", {}, []), true);
  assert.equal(needsApproval(policy, "ARCHIVE", {}, []), true);
  assert.equal(
    eligibleReviewer(policy, "author", new Set(["author", "reviewer"])),
    "reviewer",
  );
});
test("the production create contract still rejects parentId: the feature is not enabled", () => {
  assert.equal(
    createTaskSchema.safeParse({
      boardId,
      createKey: createRecordId(),
      name: "Root",
    }).success,
    true,
  );
  assert.equal(
    createTaskSchema.safeParse({
      boardId,
      createKey: createRecordId(),
      name: "Hidden child",
      parentId,
    }).success,
    false,
  );
});

test("compatible CREATE policy changes do not stale a request just because the policy version changed", () => {
  assert.doesNotThrow(() =>
    assertCreationApply(proposal(), root(), scope(), reviewer(), 2, "reviewer"),
  );
  assert.throws(
    () =>
      assertCreationApply(
        proposal(),
        root(),
        scope(),
        reviewer(),
        2,
        "reviewer",
        false,
      ),
    hasCode("STALE"),
  );
});
