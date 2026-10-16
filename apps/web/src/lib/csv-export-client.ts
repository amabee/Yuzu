import { MAX_CSV_BYTES, type CsvExportRequest } from "./csv-export";
import { saveResponseDownload } from "./download-file";
import { signalServiceStatus } from "./service-status";

export async function downloadBoardCsv(
  input: CsvExportRequest,
  onProgress?: (loaded: number, total?: number) => void,
) {
  const response = await fetch("/api/v1/boards/export", {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: { "Content-Type": "application/json", Accept: "text/csv" },
    body: JSON.stringify(input),
  }).catch((error: unknown) => {
    if (error instanceof TypeError) signalServiceStatus({ kind: "network" });
    throw error;
  });
  if (
    response.ok &&
    !response.headers.get("Content-Type")?.startsWith("text/csv")
  )
    throw new Error("The server returned an unexpected export. Try again.");
  let filename = "yuzu-tasks.csv";
  const encoded = response.headers
    .get("Content-Disposition")
    ?.match(/filename\*=UTF-8''([^;]+)/iu)?.[1];
  if (encoded) {
    try {
      filename = decodeURIComponent(encoded);
    } catch {
      /* Use the safe default filename. */
    }
  }
  await saveResponseDownload(response, filename, onProgress, MAX_CSV_BYTES);
  return { filename };
}
