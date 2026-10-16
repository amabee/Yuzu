import { describe, expect, it } from "vitest";
import { uploadChunks } from "./csv-transfer-drafts";
import type { ImportRow } from "./csv-import";

const row = (number: number, token = "signed-preview"): ImportRow => ({
  row: number,
  token,
  name: "Task",
  duplicate: false,
  values: [],
  issues: [],
});
describe("recoverable CSV handoff", () => {
  it("retains logical row numbers and explicit duplicate choices without retaining preview display data", () => {
    const item = {
      ...row(502),
      duplicate: true,
      name: "Private display title",
      values: [{ label: "Unmapped", value: "Display only" }],
    };
    expect(uploadChunks([item])).toEqual([
      [{ row: 502, token: "signed-preview", allowDuplicate: true }],
    ]);
  });
  it("bounds chunk row counts while preserving the full 25000-row selection in order", () => {
    const chunks = uploadChunks(
      Array.from({ length: 25_000 }, (_, index) => row(index + 2)),
    );
    expect(chunks).toHaveLength(250);
    expect(chunks.every((chunk) => chunk.length <= 100)).toBe(true);
    expect(chunks.flat().map((item) => item.row)).toEqual(
      Array.from({ length: 25_000 }, (_, index) => index + 2),
    );
  });
  it("splits large tickets into smaller requests, permits one large valid ticket and refuses unsigned rows", () => {
    expect(
      uploadChunks([row(2, "a".repeat(300_000)), row(3, "b".repeat(300_000))]),
    ).toHaveLength(2);
    expect(uploadChunks([row(2, "a".repeat(2_000_000))])).toHaveLength(1);
    expect(() => uploadChunks([{ ...row(2), token: undefined }])).toThrow(
      "Preview every selected row",
    );
  });
});
