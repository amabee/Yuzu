import {
  mkdir,
  readFile,
  writeFile,
  unlink,
  readdir,
  stat,
} from "node:fs/promises";
import { dirname, resolve } from "node:path";
import {
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import {
  s3Client,
  s3Bucket,
  storageProvider,
  uploadRoot,
} from "./attachment-objects";

function localPath(key: string) {
  if (
    !/^csv-jobs\/[0-9a-f-]{36}\/(?:chunk-\d+-[0-9a-f]{64}\.json|export-[0-9a-f-]{36}\.csv)$/.test(
      key,
    )
  )
    throw new Error("Invalid CSV object key.");
  return resolve(uploadRoot(), "..", key);
}
export async function putCsvObject(key: string, bytes: Uint8Array) {
  const path = localPath(key);
  if (storageProvider() === "LOCAL") {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await writeFile(path, bytes, { mode: 0o600 });
    return;
  }
  const client = s3Client();
  try {
    await client.send(
      new PutObjectCommand({
        Bucket: s3Bucket(),
        Key: key,
        Body: bytes,
        ContentType: key.endsWith(".csv") ? "text/csv" : "application/json",
      }),
    );
  } finally {
    client.destroy();
  }
}
export async function getCsvObject(
  key: string,
  limit = 3_000_000,
): Promise<Buffer> {
  const path = localPath(key);
  if (storageProvider() === "LOCAL") {
    const bytes = await readFile(/* turbopackIgnore: true */ path);
    if (bytes.length > limit)
      throw new Error("CSV object exceeds its size limit.");
    return bytes;
  }
  const client = s3Client();
  try {
    const result = await client.send(
      new GetObjectCommand({ Bucket: s3Bucket(), Key: key }),
    );
    if (!result.Body || (result.ContentLength ?? 0) > limit)
      throw new Error("Invalid CSV object size.");
    const chunks: Uint8Array[] = [];
    let size = 0;
    for await (const chunk of result.Body as AsyncIterable<Uint8Array>) {
      size += chunk.length;
      if (size > limit) throw new Error("CSV object exceeds its size limit.");
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  } finally {
    client.destroy();
  }
}
export async function deleteCsvObject(key: string) {
  const path = localPath(key);
  if (storageProvider() === "LOCAL") {
    await unlink(path).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
    return;
  }
  const client = s3Client();
  try {
    await client.send(
      new DeleteObjectCommand({ Bucket: s3Bucket(), Key: key }),
    );
  } finally {
    client.destroy();
  }
}

// Reclaim interrupted writes and objects whose board/account was removed.
export async function* staleCsvObjects(
  before: Date,
): AsyncGenerator<{ key: string; transferId: string }> {
  if (storageProvider() === "LOCAL") {
    const root = resolve(uploadRoot(), "..", "csv-jobs");
    const folders = await readdir(/* turbopackIgnore: true */ root).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return [];
        throw error;
      },
    );
    for (const id of folders) {
      if (!/^[0-9a-f-]{36}$/.test(id)) continue;
      const files = await readdir(
        /* turbopackIgnore: true */ resolve(root, id),
      );
      for (const file of files) {
        const key = `csv-jobs/${id}/${file}`;
        const path = localPath(key);
        if ((await stat(/* turbopackIgnore: true */ path)).mtime < before)
          yield { key, transferId: id };
      }
    }
    return;
  }
  const client = s3Client();
  try {
    let cursor: string | undefined;
    do {
      const result = await client.send(
        new ListObjectsV2Command({
          Bucket: s3Bucket(),
          Prefix: "csv-jobs/",
          ContinuationToken: cursor,
          MaxKeys: 1000,
        }),
      );
      for (const object of result.Contents ?? []) {
        if (
          !object.Key ||
          !object.LastModified ||
          object.LastModified >= before
        )
          continue;
        localPath(object.Key);
        yield { key: object.Key, transferId: object.Key.split("/")[1] };
      }
      cursor = result.IsTruncated ? result.NextContinuationToken : undefined;
    } while (cursor);
  } finally {
    client.destroy();
  }
}
