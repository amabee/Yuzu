import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const path = new URL("../.env", import.meta.url);
let content = await readFile(path, "utf8").catch(() => "");
for (const name of [
  "BETTER_AUTH_SECRET",
  "YUZU_SETUP_KEY",
  "SETTINGS_ENCRYPTION_KEY",
  "REALTIME_SECRET",
]) {
  const pattern = new RegExp(`^${name}=.*$`, "m");
  const existing = content
    .match(pattern)?.[0]
    .split("=")
    .slice(1)
    .join("=")
    .trim();
  if (existing) continue;
  const line = `${name}=${randomBytes(32).toString("base64url")}`;
  content = pattern.test(content)
    ? content.replace(pattern, line)
    : `${content.trimEnd()}\n${line}\n`;
}
if (!/^BETTER_AUTH_URL=/m.test(content))
  content += "BETTER_AUTH_URL=http://127.0.0.1:3000\n";
for (const [name, value] of Object.entries({
  REALTIME_INTERNAL_URL: "http://127.0.0.1:3001",
  REALTIME_PUBLIC_URL: "http://127.0.0.1:3001",
  REALTIME_PORT: "3001",
})) {
  if (!new RegExp(`^${name}=`, "m").test(content))
    content += `${name}=${value}\n`;
}
await writeFile(path, content, { mode: 0o600 });
console.log(
  "Installation keys are configured in .env. Copy YUZU_SETUP_KEY from that file into the owner step. Existing keys were preserved.",
);
