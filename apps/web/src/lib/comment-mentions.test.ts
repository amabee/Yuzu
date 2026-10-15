import { describe, expect, it } from "vitest";
import { mentionPresent, activeMention } from "./comment-mentions";
describe("mention matching", () => {
  it("matches name boundaries and treats names as literal text", () => {
    expect(
      mentionPresent("Please ask @Sarah Chen, then reply.", "Sarah Chen"),
    ).toBe(true);
    expect(mentionPresent("@Sarah Chenette", "Sarah Chen")).toBe(false);
    expect(mentionPresent("Read @Sarah Chen's notes", "Sarah Chen")).toBe(true);
    expect(mentionPresent("@A+B (review)", "A+B")).toBe(true);
    expect(mentionPresent("@AAAB", "A+B")).toBe(false);
    expect(mentionPresent("Hello @李明!", "李明")).toBe(true);
  });
  it("finds the token at the caret, ignores emails and closes completed mentions", () => {
    expect(activeMention("Hi @Sar later", 7)).toEqual({
      start: 3,
      query: "Sar",
    });
    expect(activeMention("a@example.com", 13)).toBeNull();
    expect(activeMention("Hi @Sarah Chen next", 19, ["Sarah Chen"])).toBeNull();
    expect(
      activeMention("Hi @Sarah Chen next @Bo", 23, ["Sarah Chen"]),
    ).toEqual({ start: 20, query: "Bo" });
    expect(activeMention("Hi @", 4)).toEqual({ start: 3, query: "" });
  });
});
