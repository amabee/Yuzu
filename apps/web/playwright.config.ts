import { defineConfig, devices } from "@playwright/test";
import { config } from "dotenv";
config({ path: new URL("../../.env", import.meta.url), quiet: true });
const testDatabase = new URL(process.env.DATABASE_URL!);
process.env.YUZU_E2E_ADMIN_URL = process.env.DATABASE_URL;
testDatabase.pathname = "/yuzu_e2e";
process.env.YUZU_E2E_DATABASE_URL = testDatabase.toString();
process.env.YUZU_E2E_SETUP_KEY =
  "browser-tests-only-owner-key-not-a-real-secret";

export default defineConfig({
  testDir: "./tests",
  globalSetup: "./tests/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  use: { baseURL: "http://127.0.0.1:3100", trace: "retain-on-failure" },
  projects: [{ name: "desktop", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "pnpm start --port 3100",
    url: "http://127.0.0.1:3100/api/health",
    reuseExistingServer: false,
    env: {
      DATABASE_URL: testDatabase.toString(),
      BETTER_AUTH_URL: "http://127.0.0.1:3100",
      BETTER_AUTH_SECRET: "browser-tests-only-auth-secret-not-a-real-secret",
      YUZU_SETUP_KEY: process.env.YUZU_E2E_SETUP_KEY,
      SETTINGS_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64url"),
    },
    timeout: 60_000,
  },
});
