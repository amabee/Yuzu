import { afterEach, expect, it, vi } from "vitest";
import {
  decryptSettings,
  encryptSettings,
  matchesSecret,
  readSetupBody,
} from "./security";

afterEach(() => vi.unstubAllEnvs());
it("encrypts settings with authenticated encryption and rejects tampering", () => {
  vi.stubEnv(
    "SETTINGS_ENCRYPTION_KEY",
    Buffer.alloc(32, 3).toString("base64url"),
  );
  const value = { password: "private-smtp-password" };
  const encrypted = encryptSettings(value);
  expect(encrypted).not.toContain(value.password);
  expect(decryptSettings(encrypted)).toEqual(value);
  const parts = encrypted.split(".");
  parts[1] = Buffer.alloc(16, 0).toString("base64url");
  expect(() => decryptSettings(parts.join("."))).toThrow();
  expect(encryptSettings(value)).not.toEqual(encrypted);
});
it("compares bootstrap secrets without accepting prefixes", () => {
  expect(matchesSecret("installer-key", "installer-key")).toBe(true);
  expect(matchesSecret("installer", "installer-key")).toBe(false);
});
it("rejects foreign-origin setup writes and oversized bodies", async () => {
  vi.stubEnv("BETTER_AUTH_URL", "http://127.0.0.1:3100");
  await expect(
    readSetupBody(
      new Request("http://127.0.0.1:3100/api/v1/setup/owner", {
        method: "POST",
        headers: {
          origin: "https://example.com",
          "content-type": "application/json",
        },
        body: "{}",
      }),
    ),
  ).rejects.toMatchObject({ status: 403 });
  await expect(
    readSetupBody(
      new Request("http://127.0.0.1:3100/api/v1/setup/owner", {
        method: "POST",
        headers: {
          origin: "http://127.0.0.1:3100",
          "content-type": "application/json",
        },
        body: JSON.stringify({ data: "x".repeat(17_000) }),
      }),
    ),
  ).rejects.toMatchObject({ status: 413 });
});
