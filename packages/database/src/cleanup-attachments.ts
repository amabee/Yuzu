import { config } from "dotenv";
import { readdir, stat, unlink } from "node:fs/promises";
import { resolve, isAbsolute, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getDatabase } from "./index";

config({ path: new URL("../../../.env", import.meta.url), quiet: true });
const configured = process.env.YUZU_UPLOAD_DIR;
if (configured && !isAbsolute(configured))
  throw new Error(
    "Set YUZU_UPLOAD_DIR to an absolute directory before cleanup.",
  );
const root = resolve(
  configured ||
    fileURLToPath(
      new URL("../../../apps/web/storage/attachments", import.meta.url),
    ),
);
const db = getDatabase();
try {
  const active = new Set(
    (
      await db.taskAttachment.findMany({
        where: { removedAt: null },
        select: { storageKey: true },
      })
    ).map((row) => row.storageKey),
  );
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  let removed = 0;
  const files = await readdir(root).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  for (const name of files) {
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.bin$/.test(
        name,
      )
    )
      continue;
    if (active.has(name.slice(0, -4))) continue;
    const target = resolve(root, name);
    if (dirname(target) !== root) throw new Error("Invalid cleanup target.");
    const info = await stat(target).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (!info?.isFile() || info.mtimeMs >= cutoff) continue;
    const deleted = await unlink(target)
      .then(() => true)
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return false;
        throw error;
      });
    if (deleted) removed++;
  }
  console.log(
    `Removed ${removed} unreferenced attachment file(s) older than 24 hours.`,
  );
} finally {
  await db.$disconnect();
}
