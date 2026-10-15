import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import { isAbsolute } from "node:path";
import { getDatabase } from "./index";
import {
  checkAttachmentStorage,
  s3Bucket,
  writeS3Attachment,
  verifyAttachmentObject,
} from "./attachment-objects";

config({ path: new URL("../../../.env", import.meta.url), quiet: true });
if (process.env.YUZU_UPLOAD_DIR && !isAbsolute(process.env.YUZU_UPLOAD_DIR))
  throw new Error("Set YUZU_UPLOAD_DIR to an absolute path for migration.");
process.env.YUZU_UPLOAD_DIR ||= fileURLToPath(
  new URL("../../../apps/web/storage/attachments", import.meta.url),
);
process.env.YUZU_STORAGE_PROVIDER = "S3";
const db = getDatabase();
try {
  await checkAttachmentStorage();
  const bucket = s3Bucket();
  let migrated = 0;
  let cursor: string | undefined;
  while (true) {
    const files = await db.taskAttachment.findMany({
      where: {
        storageProvider: "LOCAL",
        removedAt: null,
        ...(cursor ? { id: { gt: cursor } } : {}),
      },
      orderBy: { id: "asc" },
      take: 100,
    });
    if (!files.length) break;
    for (const file of files) {
      // Verify the local source as well as a full S3 download; metadata alone is insufficient.
      await verifyAttachmentObject(file);
      const target = await writeS3Attachment(file, bucket);
      await verifyAttachmentObject({ ...file, ...target });
      const changed = await db.taskAttachment.updateMany({
        where: { id: file.id, storageProvider: "LOCAL", removedAt: null },
        data: { storageProvider: "S3", storageBucket: bucket },
      });
      migrated += changed.count;
      cursor = file.id;
    }
  }
  console.log(
    `Migrated and SHA-256 verified ${migrated} attachment(s). Local originals were preserved. Rerunning skips migrated rows.`,
  );
} finally {
  await db.$disconnect();
}
