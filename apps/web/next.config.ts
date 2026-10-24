import type { NextConfig } from "next";
import { config } from "dotenv";

config({ path: new URL("../../.env", import.meta.url), quiet: true });

const nextConfig: NextConfig = {
  distDir: process.env.YUZU_E2E_DEV === "1" ? ".next/e2e-dev" : ".next",
  transpilePackages: ["@yuzu/database"],
  // file-type loads Node-only tokenizer modules dynamically at runtime.
  serverExternalPackages: ["file-type"],
  poweredByHeader: false,
  devIndicators: false,
  experimental: { authInterrupts: true, agentUpgrade: "security" },
};
export default nextConfig;
