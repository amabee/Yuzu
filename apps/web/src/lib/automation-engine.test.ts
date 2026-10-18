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

describe("slice 2 triggers and matching", () => {
  it("fires when the checklist becomes complete, not when it stays complete", () => {
    const trigger = { kind: "checklist.completed" as const };
    expect(
      triggerMatches(
        trigger,
        changed(
          { checklist: { done: 1, total: 2 } },
          { checklist: { done: 2, total: 2 } },
        ),
      ),
    ).toBe(true);
    expect(
      triggerMatches(
        trigger,
        changed(
          { checklist: { done: 2, total: 2 } },
          { checklist: { done: 2, total: 2 }, priority: "HIGH" },
        ),
      ),
    ).toBe(false);
    expect(
      triggerMatches(
        trigger,
        changed({ checklist: { done: 0, total: 0 } }, {}),
      ),
    ).toBe(false);
  });

  it("can require a mention for comment triggers", () => {
    const comment = (mentions: string[]) => ({
      kind: "comment.added" as const,
      after: task(),
      mentions,
    });
    expect(
      triggerMatches(
        { kind: "comment.added", mentionsOnly: true },
        comment([]),
      ),
    ).toBe(false);
    expect(
      triggerMatches(
        { kind: "comment.added", mentionsOnly: true },
        comment(["mia"]),
      ),
    ).toBe(true);
  });

  it("matches any one condition when asked", () => {
    const conditions = [
      { subject: "priority" as const, op: "is" as const, value: "HIGH" },
      { subject: "priority" as const, op: "is" as const, value: "URGENT" },
    ];
    expect(conditionsMatch(conditions, task({ priority: "URGENT" }))).toBe(
      false,
    );
    expect(
      conditionsMatch(conditions, task({ priority: "URGENT" }), "any"),
    ).toBe(true);
  });

  it("hands task creations and webhooks to the runner", () => {
    const plan = planActions(
      [
        {
          kind: "create.task",
          boardId: null,
          name: "QA: {task}",
          assigneeIds: [],
          dueInDays: null,
        },
        { kind: "webhook", url: "https://hooks.example.com/yuzu" },
      ],
      task(),
      "2026-10-30",
    );
    expect(plan.changes).toEqual({});
    expect(plan.creations).toHaveLength(1);
    expect(plan.webhooks).toEqual(["https://hooks.example.com/yuzu"]);
  });
});
