import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { config } from "dotenv";
import {
  DeleteBucketCommand,
  DeleteObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { createRecordId } from "./ids";
import {
  attachmentPath,
  objectKey,
  s3Client,
  provisionAttachmentBucket,
  writeS3Attachment,
  readAttachmentObject,
  verifyAttachmentObject,
  discardAttachmentObject,
  listAttachmentObjects,
} from "./attachment-objects";

config({ path: new URL("../../../.env", import.meta.url), quiet: true });

test("SeaweedFS keeps objects private, verifies bytes, isolates keys, and deletes files", async () => {
  const endpoint = new URL(process.env.YUZU_S3_ENDPOINT!);
  assert.ok(
    ["127.0.0.1", "localhost"].includes(endpoint.hostname),
    "Storage tests require a local S3 endpoint.",
  );
  const directory = await mkdtemp(join(tmpdir(), "yuzu-s3-test-"));
  const previous = process.env.YUZU_UPLOAD_DIR;
  process.env.YUZU_UPLOAD_DIR = directory;
  const bucket = `yuzu-storage-test-${createRecordId()}`;
  const client = s3Client();
  const bytes = Buffer.from("Private Yuzu reference 🍋");
  const file = {
    storageKey: createRecordId(),
    sizeBytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
  try {
    await provisionAttachmentBucket(bucket);
    await writeFile(attachmentPath(file.storageKey), bytes);
    const location = await writeS3Attachment(file, bucket);
    assert.equal(location.storageBucket, bucket);
    assert.equal(location.storageProvider, "S3");
    await verifyAttachmentObject({ ...file, ...location });
    await verifyAttachmentObject({
      ...file,
      storageProvider: "LOCAL",
      storageBucket: null,
    });
    const response = new Response(await readAttachmentObject(location));
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
    const anonymous = await fetch(
      new URL(`/${bucket}/${objectKey(file.storageKey)}`, endpoint),
    );
    assert.ok(
      [401, 403].includes(anonymous.status),
      `Anonymous object request returned ${anonymous.status}`,
    );
    await anonymous.body?.cancel();
    await assert.rejects(
      verifyAttachmentObject({ ...file, ...location, sha256: "0".repeat(64) }),
      /verification failed/,
    );
    await assert.rejects(
      verifyAttachmentObject({
        ...file,
        ...location,
        sizeBytes: file.sizeBytes + 1,
      }),
      /verification failed/,
    );
    const abort = new AbortController();
    abort.abort();
    await assert.rejects(readAttachmentObject(location, abort.signal));
    assert.throws(() => objectKey("../../secret"), /storage key/);
    await assert.rejects(
      readAttachmentObject({ ...location, storageProvider: "UNKNOWN" }),
      /storage location/,
    );
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: "unrelated.txt",
        Body: "not an attachment",
      }),
    );
    const eligible = [];
    for await (const entry of listAttachmentObjects(bucket))
      eligible.push(entry.storageKey);
    assert.deepEqual(eligible, [file.storageKey]);
    // Corrupt an object to ensure migration verification checks actual bytes, not stored metadata.
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: objectKey(file.storageKey),
        Body: "changed",
        Metadata: { sha256: file.sha256 },
      }),
    );
    await assert.rejects(
      verifyAttachmentObject({ ...file, ...location }),
      /verification failed/,
    );
    await discardAttachmentObject(location);
    await assert.rejects(
      readAttachmentObject(location),
      (error: unknown) =>
        (error as { $metadata: { httpStatusCode: number } }).$metadata
          .httpStatusCode === 404,
    );
    await discardAttachmentObject(location); // Removing an already absent object is safe.
  } finally {
    try {
      await client.send(
        new DeleteObjectCommand({
          Bucket: bucket,
          Key: objectKey(file.storageKey),
        }),
      );
      await client.send(
        new DeleteObjectCommand({ Bucket: bucket, Key: "unrelated.txt" }),
      );
      await client.send(new DeleteBucketCommand({ Bucket: bucket }));
    } finally {
      client.destroy();
      if (previous === undefined) delete process.env.YUZU_UPLOAD_DIR;
      else process.env.YUZU_UPLOAD_DIR = previous;
      if (!directory.startsWith(join(tmpdir(), "yuzu-s3-test-")))
        throw new Error("Invalid test cleanup path.");
      await rm(directory, { recursive: true, force: true });
    }
  }
});
