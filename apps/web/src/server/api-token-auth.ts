import { getDatabase } from "@yuzu/database";
import { TOKEN_RATE_PER_MINUTE } from "@/lib/api-token-contract";
import { digest, SetupError } from "./setup/security";

const db = () => getDatabase();
const forbidden = (message: string) =>
  new SetupError(403, "FORBIDDEN", message);
const unusable = () =>
  new SetupError(
    401,
    "INVALID_TOKEN",
    "This API token isn't valid. It may have expired or been revoked.",
  );

/**
 * The person behind an API token, after checking it's live, allowed to do
 * this kind of request, and within its rate limit.
 */
export async function tokenIdentity(secret: string, need: "read" | "write") {
  if (!/^yuzu_[A-Za-z0-9_-]{43}$/.test(secret)) throw unusable();
  const token = await db().apiToken.findUnique({
    where: { digest: digest(secret) },
    include: { user: true },
  });
  const now = new Date();
  if (
    !token ||
    token.revokedAt ||
    (token.expiresAt && token.expiresAt <= now) ||
    token.user.deactivatedAt
  )
    throw unusable();
  if (need === "write" && token.access !== "WRITE")
    throw forbidden(
      "This token is read-only. Create a Read & write token to make changes.",
    );
  const [window] = await db().$queryRaw<{ count: number }[]>`
    INSERT INTO "AuthenticationAttempt" ("id", "windowStart", "count")
    VALUES (${`api-token:${token.id}`}, ${now}, 1)
    ON CONFLICT ("id") DO UPDATE SET
      "count" = CASE WHEN "AuthenticationAttempt"."windowStart" < ${now}::timestamptz - interval '60 seconds'
        THEN 1 ELSE "AuthenticationAttempt"."count" + 1 END,
      "windowStart" = CASE WHEN "AuthenticationAttempt"."windowStart" < ${now}::timestamptz - interval '60 seconds'
        THEN ${now} ELSE "AuthenticationAttempt"."windowStart" END
    RETURNING "count"`;
  if ((window?.count ?? 0) > TOKEN_RATE_PER_MINUTE)
    throw new SetupError(
      429,
      "RATE_LIMITED",
      `Tokens can make ${TOKEN_RATE_PER_MINUTE} requests a minute. Slow down and retry shortly.`,
    );
  // "Last used" moves at most once a minute.
  await db().apiToken.updateMany({
    where: {
      id: token.id,
      OR: [
        { lastUsedAt: null },
        { lastUsedAt: { lt: new Date(now.getTime() - 60_000) } },
      ],
    },
    data: { lastUsedAt: now },
  });
  return token.user;
}
