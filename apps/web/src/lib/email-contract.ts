import { z } from "zod";

export const emailDeliveries = ["INSTANT", "DIGEST", "OFF"] as const;
export type EmailDelivery = (typeof emailDeliveries)[number];

/** Notification kinds people can choose email delivery for, with defaults. */
export const emailKinds = [
  {
    kind: "ASSIGNMENT",
    label: "Assignments",
    hint: "When someone assigns you a task",
    delivery: "INSTANT",
  },
  {
    kind: "MENTION",
    label: "Mentions",
    hint: "When someone @mentions you in a comment",
    delivery: "INSTANT",
  },
  {
    kind: "APPROVAL_REQUEST",
    label: "Approval requests",
    hint: "Changes waiting for your decision",
    delivery: "INSTANT",
  },
  {
    kind: "APPROVAL_DECISION",
    label: "Approval decisions",
    hint: "When your request is approved or rejected",
    delivery: "DIGEST",
  },
  {
    kind: "AUTOMATION",
    label: "Rule messages",
    hint: "Messages from board automations",
    delivery: "DIGEST",
  },
] as const satisfies readonly {
  kind: string;
  label: string;
  hint: string;
  delivery: EmailDelivery;
}[];
export type EmailKind = (typeof emailKinds)[number]["kind"];

export const defaultDelivery = (kind: string): EmailDelivery =>
  emailKinds.find((item) => item.kind === kind)?.delivery ?? "OFF";

const time = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a time like 08:00.");

export const emailPreferencesSchema = z.strictObject({
  preferences: z
    .array(
      z.strictObject({
        kind: z.enum(emailKinds.map((item) => item.kind) as [EmailKind]),
        delivery: z.enum(emailDeliveries),
      }),
    )
    .max(emailKinds.length),
  /** Null turns the daily digest off. */
  digestTime: time.nullable(),
});

export const emailSettingsSchema = z.object({
  preferences: z.array(
    z.object({
      kind: z.string(),
      label: z.string(),
      hint: z.string(),
      delivery: z.enum(emailDeliveries),
    }),
  ),
  digestTime: z.string().nullable(),
  timezone: z.string(),
  /** False until the installation's email is set up and verified. */
  emailReady: z.boolean(),
});
export type EmailSettings = z.infer<typeof emailSettingsSchema>;

/** Instant emails wait this long, so ones read in the app are skipped. */
export const INSTANT_DELAY_MS = 5 * 60_000;
/** Instant emails per person per hour; the rest wait for the digest. */
export const HOURLY_EMAIL_LIMIT = 30;
