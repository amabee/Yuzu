import { createHash } from "node:crypto";
import { mkdir, open } from "node:fs/promises";
import { createRecordId } from "@yuzu/database";
import {
  uploadRoot,
  attachmentPath,
  discardLocalAttachment,
} from "@yuzu/database/attachment-objects";
import { SetupError } from "./setup/security";

export { uploadRoot, attachmentPath };
export const discardAttachment = discardLocalAttachment;

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
