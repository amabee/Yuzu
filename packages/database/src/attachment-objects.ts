import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { open, unlink } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { Readable } from "node:stream";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  CreateBucketCommand,
} from "@aws-sdk/client-s3";

export type AttachmentLocation = {
  storageKey: string;
  storageProvider: string;
  storageBucket: string | null;
};
const validKey =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export const uploadRoot = () =>
  resolve(
    /* turbopackIgnore: true */ process.env.YUZU_UPLOAD_DIR ||
      "storage/attachments",
  );
export function attachmentPath(storageKey: string) {
  if (!validKey.test(storageKey))
    throw new Error("Invalid private attachment storage key.");
  const root = uploadRoot();
  const path = resolve(root, `${storageKey}.bin`);
  if (dirname(path) !== root) throw new Error("Invalid attachment path.");
  return path;
}
export function objectKey(storageKey: string) {
  if (!validKey.test(storageKey))
    throw new Error("Invalid private attachment storage key.");
  return `attachments/${storageKey}.bin`;
}
export function storageProvider() {
  const provider = process.env.YUZU_STORAGE_PROVIDER || "LOCAL";
  if (provider !== "LOCAL" && provider !== "S3")
    throw new Error("YUZU_STORAGE_PROVIDER must be LOCAL or S3.");
  return provider;
}
export function s3Bucket() {
  const bucket = process.env.YUZU_S3_BUCKET;
  if (!bucket) throw new Error("YUZU_S3_BUCKET must be configured.");
  return bucket;
}
export function s3Client() {
  const endpoint = process.env.YUZU_S3_ENDPOINT;
  const accessKeyId = process.env.YUZU_S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.YUZU_S3_SECRET_ACCESS_KEY;
  if (!endpoint || !accessKeyId || !secretAccessKey)
    throw new Error("Configure the Yuzu S3 endpoint and credentials.");
  const url = new URL(endpoint);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error("Invalid S3 endpoint.");
  return new S3Client({
    endpoint,
    region: process.env.YUZU_S3_REGION || "us-east-1",
    forcePathStyle: process.env.YUZU_S3_FORCE_PATH_STYLE !== "false",
    credentials: { accessKeyId, secretAccessKey },
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
    maxAttempts: 3,
    requestHandler: { connectionTimeout: 5000, requestTimeout: 120_000 },
  });
}
export async function discardLocalAttachment(storageKey: string) {
  await unlink(attachmentPath(storageKey)).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    },
  );
}
export async function writeS3Attachment(
  file: { storageKey: string; sizeBytes: number; sha256: string },
  bucket = s3Bucket(),
  signal?: AbortSignal,
): Promise<AttachmentLocation> {
  const client = s3Client();
  const body = createReadStream(attachmentPath(file.storageKey));
  try {
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: objectKey(file.storageKey),
        Body: body,
        ContentLength: file.sizeBytes,
        ContentType: "application/octet-stream",
        Metadata: { sha256: file.sha256 },
      }),
      { abortSignal: signal },
    );
    return {
      storageKey: file.storageKey,
      storageProvider: "S3",
      storageBucket: bucket,
    };
  } finally {
    body.destroy();
    client.destroy();
  }
}
export async function readAttachmentObject(
  file: AttachmentLocation,
  signal?: AbortSignal,
): Promise<ReadableStream<Uint8Array>> {
  if (file.storageProvider === "LOCAL") {
    const handle = await open(attachmentPath(file.storageKey), "r");
    return Readable.toWeb(
      handle.createReadStream({ signal }),
    ) as ReadableStream<Uint8Array>;
  }
  if (file.storageProvider !== "S3" || !file.storageBucket)
    throw new Error("Invalid attachment storage location.");
  const client = s3Client();
  try {
    const result = await client.send(
      new GetObjectCommand({
        Bucket: file.storageBucket,
        Key: objectKey(file.storageKey),
      }),
      { abortSignal: signal },
    );
    if (!result.Body) throw new Error("Stored file has no body.");
    // Keep the client alive until the streaming response completes or is cancelled.
    const source = result.Body.transformToWebStream().getReader();
    return new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const { done, value } = await source.read();
          if (done) {
            controller.close();
            client.destroy();
          } else controller.enqueue(value);
        } catch (error) {
          controller.error(error);
          client.destroy();
        }
      },
      async cancel(reason) {
        try {
          await source.cancel(reason);
        } finally {
          client.destroy();
        }
      },
    });
  } catch (error) {
    client.destroy();
    throw error;
  }
}
export async function discardAttachmentObject(file: AttachmentLocation) {
  if (file.storageProvider === "LOCAL")
    return discardLocalAttachment(file.storageKey);
  if (file.storageProvider !== "S3" || !file.storageBucket)
    throw new Error("Invalid attachment storage location.");
  const client = s3Client();
  try {
    await client.send(
      new DeleteObjectCommand({
        Bucket: file.storageBucket,
        Key: objectKey(file.storageKey),
      }),
    );
  } finally {
    client.destroy();
  }
}
export async function verifyAttachmentObject(
  file: AttachmentLocation & { sha256: string; sizeBytes: number },
) {
  const stream = await readAttachmentObject(file);
  const hash = createHash("sha256");
  let size = 0;
  const reader = stream.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      hash.update(value);
      if (size > file.sizeBytes)
        throw new Error(
          "Attachment verification failed: stored file is larger than expected.",
        );
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  if (size !== file.sizeBytes || hash.digest("hex") !== file.sha256)
    throw new Error(
      "Attachment verification failed: stored bytes do not match the database.",
    );
}
export async function checkAttachmentStorage() {
  if (storageProvider() === "LOCAL") return;
  const client = s3Client();
  try {
    await client.send(new HeadBucketCommand({ Bucket: s3Bucket() }));
  } finally {
    client.destroy();
  }
}
/** Explicit provisioning for installation/test tooling; web requests never create buckets. */
export async function provisionAttachmentBucket(bucket: string) {
  const client = s3Client();
  try {
    try {
      await client.send(new HeadBucketCommand({ Bucket: bucket }));
    } catch (error) {
      if (
        (error as { $metadata?: { httpStatusCode?: number } }).$metadata
          ?.httpStatusCode !== 404
      )
        throw error;
      await client.send(new CreateBucketCommand({ Bucket: bucket }));
    }
  } finally {
    client.destroy();
  }
}
/** Only Yuzu's UUID attachment objects are eligible for maintenance. */
export async function* listAttachmentObjects(bucket = s3Bucket()) {
  const client = s3Client();
  let continuation: string | undefined;
  try {
    do {
      const page = await client.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: "attachments/",
          ContinuationToken: continuation,
        }),
      );
      for (const item of page.Contents ?? []) {
        const key = item.Key?.replace(/^attachments\//, "").replace(
          /\.bin$/,
          "",
        );
        if (
          key &&
          validKey.test(key) &&
          item.Key === objectKey(key) &&
          item.LastModified
        )
          yield { storageKey: key, lastModified: item.LastModified };
      }
      continuation = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (continuation);
  } finally {
    client.destroy();
  }
}
