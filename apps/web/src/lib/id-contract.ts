import { z } from "zod";
export const recordId = z.string().uuid();
// Existing authentication identities may predate UUIDv7.
export const personId = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/);
