import { expect, it } from "vitest";
import { installationSchema, ownerSchema } from "./setup-contract";

it("rejects role injection into owner input", () => {
  const owner = {
    name: "Owner",
    email: "owner@example.test",
    password: "long-owner-password",
    confirmPassword: "long-owner-password",
    setupKey: "x".repeat(32),
  };
  expect(ownerSchema.safeParse({ ...owner, role: "OWNER" }).success).toBe(
    false,
  );
  expect(
    ownerSchema.safeParse({ ...owner, confirmPassword: "different" }).success,
  ).toBe(false);
});
it("rejects unsupported timezone and date formats", () => {
  const values = {
    name: "Team",
    timezone: "Asia/Singapore",
    defaultDateFormat: "yyyy-MM-dd",
    revision: 1,
  };
  expect(installationSchema.safeParse(values).success).toBe(true);
  expect(
    installationSchema.safeParse({ ...values, timezone: "Invalid/Timezone" })
      .success,
  ).toBe(false);
  expect(
    installationSchema.safeParse({
      ...values,
      defaultDateFormat: "custom-script",
    }).success,
  ).toBe(false);
});
