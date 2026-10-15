import type { NextConfig } from "next";
import { config } from "dotenv";

config({ path: new URL("../../.env", import.meta.url), quiet: true });

const nextConfig: NextConfig = {
  transpilePackages: ["@yuzu/database"],
  poweredByHeader: false,
  devIndicators: false,
  experimental: { authInterrupts: true },
};
export default nextConfig;
