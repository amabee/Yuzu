import { describe, expect, it } from "vitest";
import { aggregateLinks, relationConfig, rollupConfig } from "./record-links";

const a = "0199a000-0000-7000-8000-000000000001";
const b = "0199a000-0000-7000-8000-000000000002";
const c = "0199a000-0000-7000-8000-000000000003";

describe("record links", () => {
  it("reads relation and rollup config, rejecting broken config", () => {
    expect(
      relationConfig({
        targetBoardId: a,
        many: true,
        mirrorFieldId: b,
        primary: true,
      }),
    ).toMatchObject({ many: true, primary: true });
    expect(relationConfig({ targetBoardId: "nope" })).toBeNull();
    expect(
      rollupConfig({ relationFieldId: a, aggregate: "sum", targetFieldId: b }),
    ).toMatchObject({ format: "plain" });
  });

  it("counts and sums only visible, unarchived linked records", () => {
    const linked = {
      [a]: { name: "Kickoff", boardId: c, archived: false },
      [b]: { name: "Old", boardId: c, archived: true },
      // c is private: not in the map.
    };
    const ids = [a, b, c];
    expect(aggregateLinks(ids, linked, { aggregate: "count" })).toBe(1);
    expect(
      aggregateLinks(
        ids,
        linked,
        { aggregate: "sum" },
        { [a]: 120, [b]: 50, [c]: 900 },
      ),
    ).toBe(120);
    expect(aggregateLinks([], linked, { aggregate: "sum" })).toBe(0);
  });
});
