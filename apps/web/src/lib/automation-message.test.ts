import { describe, expect, it } from "vitest";
import { defaultMessage, renderMessage } from "./automation-message";

describe("rule notification messages", () => {
  const values = {
    task: "Checkout redesign",
    status: "Done",
    due: "Oct 24",
    rule: "Ship it",
  };

  it("fills {name} and ${name} placeholders", () => {
    expect(
      renderMessage(
        "{task} just shipped 🎉 It's now ${status}, due {due}.",
        values,
      ),
    ).toBe("Checkout redesign just shipped 🎉 It's now Done, due Oct 24.");
  });

  it("keeps unknown placeholders so typos are visible", () => {
    expect(renderMessage("{taks} moved to { status }", values)).toBe(
      "{taks} moved to Done",
    );
  });

  it("has a short default with or without a task", () => {
    expect(renderMessage(defaultMessage(true), values)).toBe(
      "Checkout redesign was updated by “Ship it”.",
    );
    expect(renderMessage(defaultMessage(false), values)).toBe("“Ship it” ran.");
  });
});
