import { z } from "zod";
export const recoveryRequestSchema = z.strictObject({
  email: z
    .email()
    .max(254)
    .transform((email) => email.toLowerCase()),
});
export const recoveryResetSchema = z
  .strictObject({
    token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    password: z.string().min(12).max(128),
    confirmation: z.string().min(12).max(128),
  })
  .refine((input) => input.password === input.confirmation, {
    path: ["confirmation"],
    message: "Passwords must match.",
  });
export const recoveryResultSchema = z.object({ saved: z.literal(true) });
