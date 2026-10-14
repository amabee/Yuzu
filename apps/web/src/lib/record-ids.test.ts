import { describe, expect, it } from "vitest";
import { createRecordId } from "@yuzu/database/ids";

describe("record IDs", () => {
  it("generates unique UUIDv7 values in increasing order in one process", () => {
    const ids = Array.from({ length: 1000 }, () => createRecordId());
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids)
      expect(id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    expect([...ids].sort()).toEqual(ids);
    const timestamp = Number.parseInt(
      ids[0].replaceAll("-", "").slice(0, 12),
      16,
    );
    expect(Math.abs(Date.now() - timestamp)).toBeLessThan(5000);
  });
});
