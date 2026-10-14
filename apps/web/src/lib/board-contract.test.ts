import { describe, expect, it } from "vitest";
import {
  createTaskSchema,
  optionAppearanceSchema,
  commentCreateSchema,
  personId,
  recordId,
  dateOnly,
  fieldOptions,
  updateTaskSchema,
} from "./board-contract";
describe("board request contracts", () => {
  it("validates safe option appearance and bounded comment bodies", () => {
    expect(
      optionAppearanceSchema.parse({ color: "#a855f7", icon: "clock" }),
    ).toEqual({ color: "#a855f7", icon: "clock" });
    expect(
      optionAppearanceSchema.safeParse({ color: "red; background:url(x)" })
        .success,
    ).toBe(false);
    expect(optionAppearanceSchema.safeParse({ icon: "<script>" }).success).toBe(
      false,
    );
    const base = {
      taskId: crypto.randomUUID(),
      createKey: crypto.randomUUID(),
    };
    expect(commentCreateSchema.parse({ ...base, body: "  Ready  " }).body).toBe(
      "Ready",
    );
    expect(commentCreateSchema.safeParse({ ...base, body: " " }).success).toBe(
      false,
    );
    expect(
      commentCreateSchema.safeParse({ ...base, body: "a".repeat(5001) })
        .success,
    ).toBe(false);
    expect(
      fieldOptions({
        options: [
          {
            id: "progress",
            label: "In progress",
            color: "#0ea5e9",
            icon: "clock",
          },
        ],
      })[0],
    ).toEqual({
      id: "progress",
      label: "In progress",
      color: "#0ea5e9",
      icon: "clock",
    });
  });
  it("accepts existing auth identities while retaining UUID validation for domain records", () => {
    expect(personId.parse("legacyAuthUser_123")).toBe("legacyAuthUser_123");
    expect(recordId.safeParse("legacyAuthUser_123").success).toBe(false);
    expect(personId.safeParse(" ").success).toBe(false);
    expect(personId.safeParse("a".repeat(129)).success).toBe(false);
    expect(
      createTaskSchema.safeParse({
        boardId: crypto.randomUUID(),
        createKey: crypto.randomUUID(),
        name: "Assign existing user",
        assigneeIds: ["legacyAuthUser_123"],
      }).success,
    ).toBe(true);
  });
  it("rejects impossible calendar dates, unknown mutations, and excessive task names", () => {
    expect(dateOnly.safeParse("2026-02-30").success).toBe(false);
    expect(dateOnly.parse("2028-02-29")).toBe("2028-02-29");
    expect(
      createTaskSchema.safeParse({
        boardId: crypto.randomUUID(),
        createKey: crypto.randomUUID(),
        name: "a".repeat(201),
      }).success,
    ).toBe(false);
    expect(
      updateTaskSchema.safeParse({
        taskId: crypto.randomUUID(),
        revision: 1,
        changes: { createdById: crypto.randomUUID() },
      }).success,
    ).toBe(false);
    expect(
      updateTaskSchema.safeParse({
        taskId: crypto.randomUUID(),
        revision: 1,
        changes: {},
      }).success,
    ).toBe(false);
  });
  it("preserves stored option IDs and supports the existing label-only board fixture", () => {
    expect(
      fieldOptions({
        options: [{ id: "todo", label: "To do" }, { label: "Review" }],
      }),
    ).toEqual([
      { id: "todo", label: "To do" },
      { id: "Review", label: "Review" },
    ]);
  });
});
