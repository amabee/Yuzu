import { z } from "zod";

export const ownerSchema = z
  .strictObject({
    name: z.string().trim().min(2).max(80),
    email: z
      .email()
      .max(254)
      .transform((value) => value.toLowerCase()),
    password: z.string().min(12).max(128),
    confirmPassword: z.string(),
    setupKey: z.string().min(32).max(128),
  })
  .refine((value) => value.password === value.confirmPassword, {
    path: ["confirmPassword"],
    message: "Passwords must match.",
  });
export const dateFormats = [
  "dd MMM yyyy",
  "yyyy-MM-dd",
  "dd/MM/yyyy",
  "MM/dd/yyyy",
] as const;
export const installationSchema = z.strictObject({
  name: z.string().trim().min(2).max(80),
  timezone: z
    .string()
    .max(100)
    .refine((value) => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: value }).format();
        return true;
      } catch {
        return false;
      }
    }, "Choose a valid timezone."),
  defaultDateFormat: z.enum(dateFormats),
  revision: z.number().int().positive(),
});
export const smtpSchema = z.strictObject({
  host: z
    .string()
    .trim()
    .min(1)
    .max(253)
    .refine((value) => !/[\s/@\\]/.test(value), "Enter a hostname, not a URL."),
  port: z.number().int().min(1).max(65535),
  secure: z.boolean(),
  username: z.string().max(254),
  password: z.string().max(512),
  fromEmail: z.email().max(254),
});
export const mailSchema = smtpSchema
  .extend({ revision: z.number().int().positive() })
  .strict();
export const verifySchema = z.strictObject({
  code: z.string().regex(/^\d{6}$/, "Enter the six-digit code."),
});
export const namesSchema = z.strictObject({
  // Names are persisted together so interrupted completion cannot duplicate records.
  workspaceName: z.string().trim().min(2).max(80),
  boardName: z.string().trim().min(2).max(80),
  revision: z.number().int().positive(),
});
export const ownerEmailSchema = z.strictObject({
  email: z
    .email()
    .max(254)
    .transform((value) => value.toLowerCase()),
  password: z.string().min(12).max(128),
});
export type SmtpSettings = z.infer<typeof smtpSchema>;
export type SetupStatus = {
  phase: "UNCLAIMED" | "OWNER_CREATED" | "EMAIL_VERIFIED" | "READY";
  claimed: boolean;
  authorized: boolean;
  owner?: { name: string; email: string };
  settings?: {
    name: string;
    timezone: string;
    defaultDateFormat: string;
    revision: number;
    emailConfigured: boolean;
    emailVerified: boolean;
    verificationPending: boolean;
    smtp?: Omit<SmtpSettings, "password">;
  };
  workspace?: { id: string; name: string };
  board?: { id: string; name: string };
};
