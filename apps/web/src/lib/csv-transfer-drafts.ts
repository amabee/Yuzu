import type { ImportRow } from "./csv-import";

export type UploadRow = { row: number; token: string; allowDuplicate: boolean };
export type TransferDraft = {
  id: string;
  ownerId: string;
  boardId: string;
  name: string;
  total: number;
  chunks: UploadRow[][];
  createdAt: number;
};
function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("yuzu-csv-recovery", 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("drafts", { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(
        new Error(
          "Yuzu could not save an upload recovery copy. Allow browser storage and try again.",
        ),
      );
  });
}
async function operation<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await database();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction("drafts", mode);
      const request = run(tx.objectStore("drafts"));
      tx.oncomplete = () => resolve(request.result);
      tx.onerror = tx.onabort = () =>
        reject(
          new Error(
            "There is not enough browser storage to save this import safely. Free some space and try again.",
          ),
        );
    });
  } finally {
    db.close();
  }
}
export const saveTransferDraft = (draft: TransferDraft) =>
  operation("readwrite", (store) => store.put(draft));
export const removeTransferDraft = (id: string) =>
  operation("readwrite", (store) => store.delete(id));
export const readTransferDrafts = () =>
  operation<TransferDraft[]>("readonly", (store) => store.getAll());

export function uploadChunks(rows: ImportRow[]): UploadRow[][] {
  const chunks: UploadRow[][] = [];
  let current: UploadRow[] = [],
    size = 0;
  const encoder = new TextEncoder();
  for (const row of rows) {
    if (!row.token)
      throw new Error("Preview every selected row before importing.");
    const item = {
      row: row.row,
      token: row.token,
      allowDuplicate: row.duplicate,
    };
    const bytes = encoder.encode(JSON.stringify(item)).length + 1;
    if (current.length && (current.length >= 100 || size + bytes > 500_000)) {
      chunks.push(current);
      current = [];
      size = 0;
    }
    current.push(item);
    size += bytes;
  }
  if (current.length) chunks.push(current);
  return chunks;
}
