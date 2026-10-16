import { ApiError } from "./api-client";
import { retryDeadline, signalServiceStatus } from "./service-status";

export async function saveResponseDownload(
  response: Response,
  name: string,
  onProgress?: (loaded: number, total?: number) => void,
  maxBytes = Infinity,
) {
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    if (response.status === 503 && body.error?.code === "MAINTENANCE")
      signalServiceStatus({ kind: "maintenance" });
    if (response.status === 429)
      signalServiceStatus({
        kind: "rate-limited",
        retryAt: retryDeadline(response.headers.get("Retry-After")),
      });
    throw new ApiError(
      response.status,
      body.error?.code ?? "DOWNLOAD_FAILED",
      body.error?.message ?? "This download could not start.",
    );
  }
  const length = Number(response.headers.get("Content-Length"));
  const encoding = response.headers.get("Content-Encoding");
  const total =
    (!encoding || encoding === "identity") &&
    Number.isSafeInteger(length) &&
    length > 0
      ? length
      : undefined;
  if (total !== undefined && total > maxBytes) {
    await response.body?.cancel();
    throw new Error("The download is too large. Choose a smaller selection.");
  }
  onProgress?.(0, total);
  let blob: Blob;
  if (response.body) {
    const reader = response.body.getReader();
    const chunks: ArrayBuffer[] = [];
    let loaded = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        loaded += value.byteLength;
        if (loaded > maxBytes)
          throw new Error(
            "The download is too large. Choose a smaller selection.",
          );
        chunks.push(value.slice().buffer);
        onProgress?.(loaded, total);
      }
      if (total !== undefined && loaded !== total)
        throw new Error("The download was interrupted. Try again.");
      blob = new Blob(chunks, {
        type:
          response.headers.get("Content-Type") ?? "application/octet-stream",
      });
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  } else {
    blob = await response.blob();
    if (blob.size > maxBytes)
      throw new Error("The download is too large. Choose a smaller selection.");
    onProgress?.(blob.size, total);
  }
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
