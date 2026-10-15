import { getDatabase } from "@yuzu/database";
import { provisionAttachmentBucket } from "@yuzu/database/attachment-objects";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export default async function globalSetup() {
  if (process.env.YUZU_E2E_S3 === "1") {
    if (
      !["127.0.0.1", "localhost"].includes(
        new URL(process.env.YUZU_S3_ENDPOINT!).hostname,
      )
    )
      throw new Error("S3 browser tests require local object storage.");
    await provisionAttachmentBucket("yuzu-e2e-attachments");
  }
  process.env.DATABASE_URL = process.env.YUZU_E2E_ADMIN_URL;
  const source = new URL(process.env.DATABASE_URL!);
  if (!["127.0.0.1", "localhost"].includes(source.hostname))
    throw new Error("Browser tests require a local PostgreSQL instance.");
  const db = getDatabase();
  const existing = await db.$queryRaw<
    { datname: string }[]
  >`SELECT datname FROM pg_database WHERE datname = 'yuzu_e2e'`;
  if (!existing.length)
    await db.$executeRawUnsafe('CREATE DATABASE "yuzu_e2e"');
  await db.$disconnect();
  const result = spawnSync("pnpm db:deploy", {
    shell: true,
    cwd: fileURLToPath(new URL("../../../", import.meta.url)),
    env: { ...process.env, DATABASE_URL: process.env.YUZU_E2E_DATABASE_URL },
    stdio: "pipe",
  });
  if (result.status !== 0)
    throw new Error(
      "Could not apply migrations to the isolated browser-test database.",
    );
}
