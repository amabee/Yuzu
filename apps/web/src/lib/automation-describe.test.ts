import { describe, expect, it } from "vitest";
import { describeRule, type RuleLabels } from "./automation-describe";

const labels: RuleLabels = {
  status: (id) => ({ done: "Done", todo: "To do" })[id ?? ""] ?? "No status",
  priority: (id) => id.charAt(0) + id.slice(1).toLowerCase(),
  group: (id) => (id ? "Shipped" : "No group"),
  person: () => "Mia",
  field: () => "Labels",
  option: () => "Design",
};
const text = (parts: { text: string }[]) => parts.map((p) => p.text).join("");

describe("rule sentences", () => {
  it("reads When / if / then with joined lists", () => {
    expect(
      text(
        describeRule(
          {
            trigger: { kind: "status.changed", from: null, to: "done" },
            conditions: [
              { subject: "priority", op: "is", value: "HIGH" },
              { subject: "group", op: "is_not", value: "g" },
            ],
            actions: [
              { kind: "notify", to: "creator" },
              { kind: "set.group", value: "g" },
              { kind: "set.date", field: "dueDate", days: 3 },
            ],
          },
          labels,
        ),
      ),
    ).toBe(
      "When status changes to Done, if priority is High and group is not Shipped, then notify the creator, move to Shipped and set the due date to in 3 days.",
    );
  });

  it("marks the chosen values as strong", () => {
    const parts = describeRule(
      {
        trigger: { kind: "due.overdue" },
        conditions: [],
        actions: [{ kind: "assign", userId: "mia" }],
      },
      labels,
    );
    expect(
      parts.filter((part) => part.strong).map((part) => part.text),
    ).toEqual(["overdue", "assign Mia"]);
  });
});
