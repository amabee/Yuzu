import { z } from "zod";

export const TOKEN_LIMIT = 20;
export const TOKEN_RATE_PER_MINUTE = 120;
export const tokenExpiries = {
  "30": "30 days",
  "90": "90 days",
  "365": "1 year",
  never: "Never",
} as const;

export const createTokenSchema = z.strictObject({
  name: z.string().trim().min(1, "Name the token.").max(60),
  access: z.enum(["READ", "WRITE"]),
  expires: z.enum(["30", "90", "365", "never"]).default("90"),
});
export const revokeTokenSchema = z.strictObject({
  id: z.string().min(1).max(100),
});

const token = z.object({
  id: z.string(),
  name: z.string(),
  prefix: z.string(),
  access: z.enum(["READ", "WRITE"]),
  createdAt: z.string(),
  expiresAt: z.string().nullable(),
  lastUsedAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
  owner: z.string().optional(),
});
export type ApiTokenView = z.infer<typeof token>;
export const tokenListSchema = z.object({
  tokens: z.array(token),
  canSeeAll: z.boolean(),
});
export const createdTokenSchema = z.object({
  token: z.string(),
  view: token,
});

/** "Expired", "Expires in 5 days", "Expires Jan 17" or "Never expires". */
export function expiryLabel(expiresAt: string | null, now = Date.now()) {
  if (!expiresAt) return { text: "Never expires", tone: "quiet" as const };
  const days = Math.ceil((new Date(expiresAt).getTime() - now) / 86_400_000);
  if (days <= 0) return { text: "Expired", tone: "gone" as const };
  if (days <= 7)
    return {
      text: days === 1 ? "Expires tomorrow" : `Expires in ${days} days`,
      tone: "soon" as const,
    };
  return {
    text: `Expires ${new Date(expiresAt).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      ...(days > 300 ? { year: "numeric" } : {}),
    })}`,
    tone: "quiet" as const,
  };
}
