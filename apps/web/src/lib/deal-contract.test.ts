import { describe, expect, it } from "vitest";
import {
  dealAmount,
  dealCurrency,
  needsStageReason,
  stageCommandSchema,
  stageTransition,
} from "./deal-contract";
import { updateTaskSchema } from "./board-contract";

describe("deal fields", () => {
  it("keeps amounts as exact decimal text", () => {
    expect(dealAmount.parse(1500)).toBe("1500");
    expect(dealAmount.parse("001,250.5000")).toBe("1250.5");
    expect(dealAmount.parse("0.1234")).toBe("0.1234");
    expect(dealAmount.parse("")).toBeNull();
    expect(dealAmount.parse(null)).toBeNull();
    for (const bad of ["-5", "1.23456", "1e5", "abc", "1234567890123456"])
      expect(dealAmount.safeParse(bad).success, bad).toBe(false);
  });

  it("takes three-letter currency codes", () => {
    expect(dealCurrency.parse(" usd ")).toBe("USD");
    expect(dealCurrency.safeParse("pesos").success).toBe(false);
  });

  it("ride along with ordinary record changes", () => {
    const parsed = updateTaskSchema.parse({
      taskId: "0199c7a0-0000-7000-8000-000000000001",
      revision: 2,
      changes: {
        stageId: "0199c7a0-0000-7000-8000-000000000002",
        amount: "12,000",
        stageReason: " Lost to a competitor ",
      },
    });
    expect(parsed.changes).toMatchObject({
      amount: "12000",
      stageReason: "Lost to a competitor",
    });
  });
});

describe("stage transitions", () => {
  it("names each move by its categories", () => {
    expect(stageTransition(null, "OPEN")).toBe("CREATED");
    expect(stageTransition("OPEN", "OPEN")).toBe("MOVED");
    expect(stageTransition("OPEN", "WON")).toBe("WON");
    expect(stageTransition("WON", "LOST")).toBe("LOST");
    expect(stageTransition("LOST", "OPEN")).toBe("REOPENED");
    expect(stageTransition("WON", "WON")).toBe("MOVED");
  });

  it("asks for a reason only between Won and Lost", () => {
    expect(needsStageReason("WON", "LOST")).toBe(true);
    expect(needsStageReason("LOST", "WON")).toBe(true);
    expect(needsStageReason("OPEN", "WON")).toBe(false);
    expect(needsStageReason("WON", "OPEN")).toBe(false);
  });

  it("checks stage commands against a pipeline version", () => {
    const boardId = "0199c7a0-0000-7000-8000-000000000003";
    expect(
      stageCommandSchema.safeParse({
        action: "add",
        boardId,
        version: 1,
        name: "Demo",
        category: "OPEN",
      }).success,
    ).toBe(true);
    expect(
      stageCommandSchema.safeParse({
        action: "add",
        boardId,
        name: "Demo",
        category: "OPEN",
      }).success,
    ).toBe(false);
    expect(
      stageCommandSchema.safeParse({
        action: "add",
        boardId,
        version: 1,
        name: "x".repeat(41),
        category: "OPEN",
      }).success,
    ).toBe(false);
  });
});
