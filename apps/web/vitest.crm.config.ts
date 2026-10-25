import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
config({ path: new URL("../../.env", import.meta.url), quiet: true });
const testUrl = new URL(
  process.env.YUZU_E2E_DATABASE_URL ?? process.env.DATABASE_URL!,
);
if (!process.env.YUZU_E2E_DATABASE_URL) testUrl.pathname = "/yuzu_e2e";
if (
  testUrl.pathname !== "/yuzu_e2e" ||
  !["localhost", "127.0.0.1"].includes(testUrl.hostname)
)
  throw new Error("CRM integration tests require local yuzu_e2e.");
process.env.DATABASE_URL = testUrl.toString();
process.env.SETTINGS_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64url");
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    environment: "node",
    include: [
      "tests/crm-data.integration.ts",
      "tests/deals-data.integration.ts",
      "tests/stage-requests.integration.ts",
    ],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
