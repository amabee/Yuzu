import { saveResponseDownload } from "./download-file";
import { ApiError, type ApiResponse } from "./api-client";
import { retryDeadline, signalServiceStatus } from "./service-status";

/** XHR provides real upload progress; mutation retries always remain explicit. */
export function uploadTaskFile(
  taskId: string,
  file: File,
  uploadKey: string,
  progress: (percent: number) => void,
  signal: AbortSignal,
) {
  return new Promise<ApiResponse<{ id: string }>>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(
      "POST",
      `/api/v1/attachments?taskId=${encodeURIComponent(taskId)}`,
    );
    xhr.withCredentials = true;
    xhr.timeout = 125_000;
    xhr.setRequestHeader(
      "Content-Type",
      file.type || "application/octet-stream",
    );
    xhr.setRequestHeader("Accept", "application/json");
    xhr.setRequestHeader("X-Yuzu-File-Name", encodeURIComponent(file.name));
    xhr.setRequestHeader("X-Yuzu-Upload-Key", uploadKey);
    const abort = () => xhr.abort();
    const finish = () => signal.removeEventListener("abort", abort);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable)
        progress(Math.min(99, Math.round((event.loaded / event.total) * 100)));
    };
    xhr.onload = () => {
      finish();
      if (xhr.status === 429)
        signalServiceStatus({
          kind: "rate-limited",
          retryAt: retryDeadline(xhr.getResponseHeader("Retry-After")),
        });
      try {
        const payload = JSON.parse(xhr.responseText);
        if (
          xhr.status >= 200 &&
          xhr.status < 300 &&
          typeof payload.data?.id === "string"
        ) {
          progress(100);
          resolve(payload);
        } else {
          if (xhr.status === 503 && payload.error?.code === "MAINTENANCE")
            signalServiceStatus({ kind: "maintenance" });
          reject(
            new ApiError(
              xhr.status,
              payload.error?.code ?? "UPLOAD_FAILED",
              payload.error?.message ?? "The upload could not finish.",
              payload.requestId,
            ),
          );
        }
      } catch {
        reject(
          new ApiError(
            xhr.status,
            "INVALID_RESPONSE",
            "The upload response could not be read. Try again.",
          ),
        );
      }
    };
    xhr.onerror = () => {
      finish();
      signalServiceStatus({ kind: "network" });
      reject(
        new Error(
          "The connection was interrupted. Retry this upload when connected.",
        ),
      );
    };
    xhr.ontimeout = () => {
      finish();
      reject(new Error("The upload timed out. Try again."));
    };
    xhr.onabort = () => {
      finish();
      reject(new DOMException("Upload cancelled", "AbortError"));
    };
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) {
      finish();
      reject(new DOMException("Upload cancelled", "AbortError"));
      return;
    }
    xhr.send(file);
  });
}

export async function downloadTaskFile(
  id: string,
  name: string,
  onProgress?: (loaded: number, total?: number) => void,
) {
  const response = await fetch(`/api/v1/attachments/${id}`, {
    credentials: "same-origin",
    cache: "no-store",
  }).catch((error: unknown) => {
    if (error instanceof TypeError) signalServiceStatus({ kind: "network" });
    throw error;
  });
  await saveResponseDownload(response, name, onProgress);
}
