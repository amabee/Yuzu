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

it("stacks CRM record cards without repeating one already open", () => {
  const store = createUiStore();
  const { openCrmRecord, trimCrmStack } = store.getState();
  openCrmRecord("a", "fresh");
  openCrmRecord("b", "stack");
  openCrmRecord("c", "stack");
  expect(store.getState().crmStack).toEqual(["a", "b", "c"]);
  openCrmRecord("a", "stack");
  expect(store.getState().crmStack).toEqual(["a"]);
  openCrmRecord("b", "stack");
  openCrmRecord("d", "replace");
  expect(store.getState().crmStack).toEqual(["a", "d"]);
  trimCrmStack(0);
  expect(store.getState().crmStack).toEqual([]);
  store.getState().toggleCrmColumn("COMPANY", "address");
  expect(store.getState().crmHiddenColumns.COMPANY).toEqual(["legalName"]);
});
