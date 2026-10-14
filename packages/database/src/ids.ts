import { v7 } from "uuid";

/** Generate a time-ordered UUIDv7 for a new record. Never use IDs as access tokens. */
export function createRecordId() {
  return v7();
}
