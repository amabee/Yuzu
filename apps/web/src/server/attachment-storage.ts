import { createHash } from "node:crypto";
import { mkdir, open, unlink } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { createRecordId } from "@yuzu/database";
import { SetupError } from "./setup/security";

export const uploadRoot = () =>
  resolve(
    /* turbopackIgnore: true */ process.env.YUZU_UPLOAD_DIR ||
      "storage/attachments",
  );
export function attachmentPath(storageKey: string) {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
      storageKey,
    )
  )
    throw new Error("Invalid private attachment storage key.");
  const path = resolve(uploadRoot(), `${storageKey}.bin`);
  if (dirname(path) !== uploadRoot())
    throw new Error("Invalid attachment path.");
  return path;
}
export async function discardAttachment(storageKey: string) {
  try {
    await unlink(attachmentPath(storageKey));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

/** Stream directly to private disk, bounding actual bytes even without Content-Length. */
export async function receiveAttachment(request: Request, maxBytes: number) {
  const length = request.headers.get("content-length");
  if (length !== null && Number(length) > maxBytes)
    throw new SetupError(
      413,
      "FILE_TOO_LARGE",
      "This file exceeds the installation's upload limit.",
    );
  const reader = request.body?.getReader();
  if (!reader)
    throw new SetupError(422, "EMPTY_FILE", "Choose a non-empty file.");
  const storageKey = createRecordId();
  await mkdir(uploadRoot(), { recursive: true, mode: 0o700 });
  const handle = await open(attachmentPath(storageKey), "wx", 0o600);
  const hash = createHash("sha256");
  let sizeBytes = 0;
  let timedOut = false;
  const abort = () => {
    void reader.cancel().catch(() => {});
  };
  request.signal.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(() => {
    timedOut = true;
    abort();
  }, 120_000);
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      sizeBytes += value.byteLength;
      if (sizeBytes > maxBytes)
        throw new SetupError(
          413,
          "FILE_TOO_LARGE",
          "This file exceeds the installation's upload limit.",
        );
      hash.update(value);
      let offset = 0;
      while (offset < value.length) {
        const { bytesWritten } = await handle.write(
          value,
          offset,
          value.length - offset,
        );
        if (!bytesWritten) throw new Error("Could not write attachment bytes.");
        offset += bytesWritten;
      }
    }
    if (timedOut)
      throw new SetupError(
        408,
        "UPLOAD_TIMED_OUT",
        "The upload took too long. Try again.",
      );
    if (!sizeBytes)
      throw new SetupError(422, "EMPTY_FILE", "Choose a non-empty file.");
    if (
      request.signal.aborted ||
      (length !== null && sizeBytes !== Number(length))
    )
      throw new SetupError(
        422,
        "INCOMPLETE_UPLOAD",
        "The upload was interrupted. Try again.",
      );
    await handle.sync();
    await handle.close();
    return { storageKey, sizeBytes, sha256: hash.digest("hex") };
  } catch (error) {
    await reader.cancel().catch(() => {});
    await handle.close().catch(() => {});
    await discardAttachment(storageKey);
    throw error;
  } finally {
    clearTimeout(timeout);
    request.signal.removeEventListener("abort", abort);
    reader.releaseLock();
  }
}
