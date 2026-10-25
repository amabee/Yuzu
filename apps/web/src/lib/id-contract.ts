import { z } from "zod";
export const recordId = z.string().uuid();
// Existing authentication identities may predate UUIDv7.
export const personId = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/);
/** Email syntax shared by EMAIL fields (320 characters) and CRM profiles (254). */
export const emailAddress = z
  .string()
  .email("Enter an email like name@company.com.");
