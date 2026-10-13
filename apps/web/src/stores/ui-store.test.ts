import { expect, it } from "vitest";
import { createUiStore } from "./ui-store";

it("isolates UI state between provider instances and resets local state", () => {
  const first = createUiStore();
  const second = createUiStore();
  first.getState().setMobileNavigationOpen(true);
  expect(second.getState().mobileNavigationOpen).toBe(false);
  first.getState().reset();
  expect(first.getState().mobileNavigationOpen).toBe(false);
});
