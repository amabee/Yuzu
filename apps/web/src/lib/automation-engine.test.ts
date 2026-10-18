import { describe, expect, it } from "vitest";
import {
  conditionsMatch,
  planActions,
  triggerMatches,
  type RuleTask,
} from "./automation-engine";
import { automationRuleInputSchema } from "./automation-contract";

const task = (patch: Partial<RuleTask> = {}): RuleTask => ({
  statusId: "todo",
  priority: "NORMAL",
  groupId: null,
  assigneeIds: [],
  startDate: null,
  dueDate: null,
  fieldValues: {},
  ...patch,
});
const changed = (before: Partial<RuleTask>, after: Partial<RuleTask>) => ({
  kind: "task.changed" as const,
  before: task(before),
  after: task({ ...before, ...after }),
});
const fieldId = "0199a000-0000-7000-8000-000000000001";

describe("automation triggers", () => {
  it("matches status changes to the chosen status, from any or one status", () => {
    const toDone = changed({ statusId: "in_progress" }, { statusId: "done" });
    expect(
      triggerMatches(
        { kind: "status.changed", from: null, to: "done" },
        toDone,
      ),
    ).toBe(true);
    expect(
      triggerMatches(
        { kind: "status.changed", from: "todo", to: "done" },
        toDone,
      ),
    ).toBe(false);
    expect(
      triggerMatches(
        { kind: "status.changed", from: null, to: "done" },
        changed({ statusId: "done" }, { priority: "HIGH" }),
      ),
    ).toBe(false);
  });

  it("treats people on a new task as newly assigned", () => {
    expect(
      triggerMatches(
        { kind: "assignee.added", userId: "mia" },
        { kind: "task.created", after: task({ assigneeIds: ["mia"] }) },
      ),
    ).toBe(true);
    expect(
      triggerMatches(
        { kind: "assignee.added", userId: null },
        changed({ assigneeIds: ["mia"] }, { assigneeIds: ["mia"] }),
      ),
    ).toBe(false);
  });

  it("fires field changes only when the value newly appears", () => {
    const trigger = {
      kind: "field.changed" as const,
      field: fieldId,
      value: "design",
    };
    expect(
      triggerMatches(
        trigger,
        changed(
          { fieldValues: { [fieldId]: ["backend"] } },
          { fieldValues: { [fieldId]: ["backend", "design"] } },
        ),
      ),
    ).toBe(true);
    expect(
      triggerMatches(
        trigger,
        changed(
          { fieldValues: { [fieldId]: ["design"] } },
          { fieldValues: { [fieldId]: ["design", "backend"] } },
        ),
      ),
    ).toBe(false);
  });
});

describe("automation conditions", () => {
  it("requires every condition", () => {
    const current = task({ priority: "HIGH", assigneeIds: ["mia"] });
    expect(
      conditionsMatch(
        [
          { subject: "priority", op: "is", value: "HIGH" },
          { subject: "assignees", op: "include", userId: "mia" },
          { subject: "group", op: "is_not", value: "shipped" },
        ],
        current,
      ),
    ).toBe(true);
    expect(conditionsMatch([{ subject: "due", op: "set" }], current)).toBe(
      false,
    );
    expect(
      conditionsMatch(
        [{ subject: "field", fieldId, op: "is", value: false }],
        current,
      ),
    ).toBe(true);
  });
});

describe("automation actions", () => {
  it("returns only real changes plus notices", () => {
    const { changes, notices } = planActions(
      [
        { kind: "set.status", value: "todo" },
        { kind: "set.priority", value: "URGENT" },
        { kind: "assign", userId: "mia" },
        { kind: "assign", userId: "mia" },
        { kind: "set.date", field: "dueDate", days: 3 },
        { kind: "notify", to: "creator" },
      ],
      task(),
      "2026-10-30",
    );
    expect(changes).toEqual({
      priority: "URGENT",
      assigneeIds: ["mia"],
      dueDate: "2026-11-02",
    });
    expect(notices).toEqual([{ to: "creator", userIds: [] }]);
  });

  it("rejects rules without actions or with too many", () => {
    const base = {
      boardId: "0199a000-0000-7000-8000-000000000002",
      name: "Ship it",
      trigger: { kind: "task.created" },
    };
    expect(
      automationRuleInputSchema.safeParse({ ...base, actions: [] }).success,
    ).toBe(false);
    expect(
      automationRuleInputSchema.safeParse({
        ...base,
        actions: Array.from({ length: 11 }, () => ({
          kind: "notify",
          to: "creator",
        })),
      }).success,
    ).toBe(false);
  });
});
