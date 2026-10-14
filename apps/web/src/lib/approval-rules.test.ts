import { describe, expect, it } from "vitest";
import {
  approvalPolicySchema,
  configureApprovalSchema,
  proposalDecisionSchema,
  taskMutationResultSchema,
} from "./approval-contract";
import {
  approvalConflicts,
  compatiblePolicy,
  eligibleReviewer,
  needsApproval,
  actualApprovalChanges,
} from "./approval-rules";
const boardId = "019aa1c0-1111-7111-8111-111111111111";
const assignees = "019aa1c0-2222-7222-8222-222222222222";
const status = "019aa1c0-3333-7333-8333-333333333333";
const custom = "019aa1c0-4444-7444-8444-444444444444";
const fields = [
  { id: assignees, key: "assignees" },
  { id: status, key: "status" },
];
const policy = approvalPolicySchema.parse({
  version: 1,
  enabled: true,
  requireCreation: false,
  requireChanges: true,
  requireArchive: false,
  protectedFieldIds: [assignees],
  primaryApproverId: "primary",
  backupApproverId: "backup",
});
describe("approval requirements", () => {
  it("treats cleared text and empty selections as empty, without conflating false or zero", () => {
    expect(
      actualApprovalChanges(
        { fieldValues: {} },
        { fieldValues: { [custom]: [] } },
      ),
    ).toEqual({});
    expect(
      actualApprovalChanges(
        { fieldValues: { [custom]: null } },
        { fieldValues: { [custom]: "" } },
      ),
    ).toEqual({});
    expect(
      actualApprovalChanges(
        { fieldValues: { [custom]: null } },
        { fieldValues: { [custom]: false } },
      ),
    ).toEqual({ fieldValues: { [custom]: false } });
    expect(
      actualApprovalChanges(
        { fieldValues: { [custom]: null } },
        { fieldValues: { [custom]: 0 } },
      ),
    ).toEqual({ fieldValues: { [custom]: 0 } });
  });
  it("leaves direct boards alone and requires only configured operations/fields", () => {
    expect(
      needsApproval(
        { ...policy, enabled: false },
        "UPDATE",
        { assigneeIds: ["a"] },
        fields,
      ),
    ).toBe(false);
    expect(needsApproval(policy, "CREATE", {}, fields)).toBe(false);
    expect(
      needsApproval({ ...policy, requireCreation: true }, "CREATE", {}, fields),
    ).toBe(true);
    expect(
      needsApproval(policy, "UPDATE", { description: "notes" }, fields),
    ).toBe(false);
    expect(
      needsApproval(
        policy,
        "UPDATE",
        { assigneeIds: ["a"], description: "notes" },
        fields,
      ),
    ).toBe(true);
    expect(
      needsApproval(
        { ...policy, protectedFieldIds: [custom] },
        "UPDATE",
        { fieldValues: { [custom]: false } },
        fields,
      ),
    ).toBe(true);
    expect(
      needsApproval({ ...policy, requireArchive: true }, "ARCHIVE", {}, fields),
    ).toBe(true);
  });
  it("ignores unchanged protected values, including reordered selections", () => {
    expect(
      actualApprovalChanges(
        {
          assigneeIds: ["a", "b"],
          description: "old",
          fieldValues: { [custom]: 0 },
        },
        {
          assigneeIds: ["b", "a"],
          description: "new",
          fieldValues: { [custom]: 0 },
        },
      ),
    ).toEqual({ description: "new" });
  });
  it("uses the primary for teammates, backup for the primary, and never the author", () => {
    const eligible = new Set(["primary", "backup", "member"]);
    expect(eligibleReviewer(policy, "member", eligible)).toBe("primary");
    expect(eligibleReviewer(policy, "primary", eligible)).toBe("backup");
    expect(
      eligibleReviewer(
        { ...policy, backupApproverId: null },
        "primary",
        eligible,
      ),
    ).toBeNull();
    expect(eligibleReviewer(policy, "member", new Set(["backup"]))).toBe(
      "backup",
    );
  });
  it("preserves compatible pending requests and invalidates changed requirements", () => {
    expect(
      compatiblePolicy(
        policy,
        {
          ...policy,
          version: 2,
          requireArchive: true,
          primaryApproverId: "replacement",
        },
        "UPDATE",
        { assigneeIds: ["a"] },
        fields,
      ),
    ).toBe(true);
    expect(
      compatiblePolicy(
        policy,
        { ...policy, enabled: false },
        "UPDATE",
        { assigneeIds: ["a"] },
        fields,
      ),
    ).toBe(false);
    expect(
      compatiblePolicy(
        policy,
        { ...policy, protectedFieldIds: [status] },
        "UPDATE",
        { assigneeIds: ["a"] },
        fields,
      ),
    ).toBe(false);
  });
  it("compares only affected fields and distinguishes false/zero from empty", () => {
    const before = {
      description: "old",
      statusId: "todo",
      fieldValues: { [custom]: false },
    };
    expect(
      approvalConflicts(
        before,
        { ...before, statusId: "progress" },
        { description: "new" },
        "UPDATE",
      ),
    ).toEqual([]);
    expect(
      approvalConflicts(
        before,
        { ...before, description: "other" },
        { description: "new" },
        "UPDATE",
      ),
    ).toEqual(["description"]);
    expect(
      approvalConflicts(
        before,
        { ...before, fieldValues: { [custom]: null } },
        { fieldValues: { [custom]: true } },
        "UPDATE",
      ),
    ).toEqual([`field:${custom}`]);
    expect(
      approvalConflicts(
        { archivedAt: null },
        { archivedAt: "now" },
        {},
        "ARCHIVE",
      ),
    ).toEqual(["archivedAt"]);
  });
  it("requires rejection reasons and distinct reviewers and keeps pending separate from applied", () => {
    expect(
      proposalDecisionSchema.safeParse({
        proposalId: boardId,
        action: "reject",
        reason: " ",
      }).success,
    ).toBe(false);
    expect(
      configureApprovalSchema.safeParse({
        ...policy,
        boardId,
        backupApproverId: "primary",
      }).success,
    ).toBe(false);
    expect(
      taskMutationResultSchema.parse({
        outcome: "PENDING_APPROVAL",
        proposalId: boardId,
        taskId: null,
      }).outcome,
    ).toBe("PENDING_APPROVAL");
    expect(
      taskMutationResultSchema.safeParse({
        outcome: "APPLIED",
        proposalId: boardId,
        taskId: null,
      }).success,
    ).toBe(false);
  });
});
