import { describe, expect, it } from "vitest";
import {
  aRecord,
  countOf,
  formatNumber,
  resolveRecordConfig,
} from "./record-types";

describe("record types", () => {
  it("gives existing boards the Task defaults with everything on", () => {
    const config = resolveRecordConfig("TASK", {});
    expect(config.singular).toBe("Task");
    expect(Object.values(config.builtins).every((item) => item.on)).toBe(true);
  });

  it("keeps a Deal's locked fields on and its names fixed", () => {
    const config = resolveRecordConfig("DEAL", {
      singular: "Opportunity",
      builtins: {
        status: { on: false },
        assignees: { on: false },
        priority: { on: true },
      },
    });
    expect(config.singular).toBe("Deal");
    expect(config.builtins.status).toEqual({ on: true, label: "Stage" });
    expect(config.builtins.assignees.on).toBe(true);
    expect(config.builtins.priority.on).toBe(true);
  });

  it("lets custom boards name their records and switch fields", () => {
    const config = resolveRecordConfig("CUSTOM", {
      singular: "Candidate",
      plural: "Candidates",
      builtins: {
        priority: { on: false },
        dueDate: { on: true, label: "Decision by" },
      },
    });
    expect(countOf(config, 1)).toBe("1 candidate");
    expect(countOf(config, 3)).toBe("3 candidates");
    expect(aRecord(config)).toBe("a candidate");
    expect(config.builtins.priority.on).toBe(false);
    expect(config.builtins.dueDate.label).toBe("Decision by");
  });

  it("falls back to defaults when saved config is broken", () => {
    expect(resolveRecordConfig("CUSTOM", { singular: 42 }).singular).toBe(
      "Item",
    );
    expect(aRecord(resolveRecordConfig("CUSTOM", {}))).toBe("an item");
  });

  it("formats currency and percent numbers", () => {
    expect(
      formatNumber(16400, { format: "currency", decimals: 2 }, "PHP", "en-US"),
    ).toBe("₱16,400.00");
    expect(formatNumber(60, { format: "percent" }, "PHP", "en-US")).toBe("60%");
    expect(formatNumber(1234.5, {}, "PHP", "en-US")).toBe("1,234.5");
  });
});
