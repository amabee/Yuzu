import { describe, expect, it } from "vitest";
import { mentionPresent } from "./comment-mentions";
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
});
