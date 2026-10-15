import { describe, expect, it } from "vitest";
import { toastDuration, toastProgress } from "./yuzu-toast";
describe("toast timing and progress", () => {
  it("keeps ongoing work visible and bounds configurable dismissal", () => {
    const notice = { id: "demo", kind: "success" as const, message: "Saved" };
    expect(toastDuration(notice)).toBe(5000);
    expect(toastDuration({ ...notice, duration: null })).toBe(5000);
    expect(toastDuration({ ...notice, kind: "loading", duration: 1000 })).toBe(
      Infinity,
    );
    expect(toastDuration({ ...notice, icon: "upload", progress: 100 })).toBe(
      5000,
    );
    expect(toastDuration({ ...notice, icon: "download", kind: "error" })).toBe(
      5000,
    );
    expect(toastDuration({ ...notice, kind: "loading" })).toBe(Infinity);
    expect(toastDuration({ ...notice, duration: -100 })).toBe(1000);
    expect(toastDuration({ ...notice, duration: 999999 })).toBe(60000);
  });
  it("keeps progress in the valid range", () => {
    expect(toastProgress(-5)).toBe(0);
    expect(toastProgress(75)).toBe(75);
    expect(toastProgress(150)).toBe(100);
    expect(toastProgress(NaN)).toBe(0);
  });
});
