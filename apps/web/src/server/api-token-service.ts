import { randomBytes } from "node:crypto";
import { createRecordId, getDatabase } from "@yuzu/database";
import {
  createTokenSchema,
  revokeTokenSchema,
  TOKEN_LIMIT,
} from "@/lib/api-token-contract";
import { digest, SetupError } from "./setup/security";
import { isAdministrator, requireIdentity } from "./team-access";
import { audit } from "./audit";

const db = () => getDatabase();
const forbidden = (message: string) =>
  new SetupError(403, "FORBIDDEN", message);

type TokenRow = {
  id: string;
  name: string;
  prefix: string;
  access: string;
  createdAt: Date;
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
  user?: { name: string };
};
const present = (row: TokenRow) => ({
  id: row.id,
  name: row.name,
  prefix: row.prefix,
  access: row.access as "READ" | "WRITE",
  createdAt: row.createdAt.toISOString(),
  expiresAt: row.expiresAt?.toISOString() ?? null,
  lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
  revokedAt: row.revokedAt?.toISOString() ?? null,
  ...(row.user ? { owner: row.user.name } : {}),
});

/** Your tokens, or (admins, `all`) everyone's. Revoked ones drop off. */
export async function listTokens(headers: Headers, all = false) {
  const { user } = await requireIdentity(headers);
  if (all && !isAdministrator(user.role))
    throw forbidden("Only owners and admins can see everyone's tokens.");
  const rows = await db().apiToken.findMany({
    where: { revokedAt: null, ...(all ? {} : { userId: user.id }) },
    orderBy: { id: "desc" },
    take: all ? 500 : TOKEN_LIMIT * 2,
    include: all ? { user: { select: { name: true } } } : undefined,
  });
  return { tokens: rows.map(present), canSeeAll: isAdministrator(user.role) };
}

export async function createToken(input: unknown, headers: Headers) {
  const { user } = await requireIdentity(headers);
  const body = createTokenSchema.parse(input);
  const secret = `yuzu_${randomBytes(32).toString("base64url")}`;
  const row = await db().$transaction(
    async (tx) => {
      const active = await tx.apiToken.count({
        where: {
          userId: user.id,
          revokedAt: null,
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
      });
      if (active >= TOKEN_LIMIT)
        throw new SetupError(
          409,
          "TOKEN_LIMIT",
          `You have ${TOKEN_LIMIT} active tokens. Revoke one you no longer use first.`,
        );
      const created = await tx.apiToken.create({
        data: {
          id: createRecordId(),
          userId: user.id,
          name: body.name,
          prefix: secret.slice(0, 9),
          digest: digest(secret),
          access: body.access,
          expiresAt:
            body.expires === "never"
              ? null
              : new Date(Date.now() + Number(body.expires) * 86_400_000),
        },
      });
      await audit(tx, {
        actorId: user.id,
        action: "API_TOKEN_CREATED",
        subject: body.name,
        subjectId: created.id,
        details: body.access === "WRITE" ? "Read & write" : "Read only",
      });
      return created;
    },
    { isolationLevel: "Serializable" },
  );
  // The only time the secret leaves the server.
  return { token: secret, view: present(row) };
}

export async function revokeToken(input: unknown, headers: Headers) {
  const { user } = await requireIdentity(headers);
  const { id } = revokeTokenSchema.parse(input);
  await db().$transaction(async (tx) => {
    const token = await tx.apiToken.findUnique({
      where: { id },
      include: { user: { select: { name: true } } },
    });
    if (!token || token.revokedAt)
      throw new SetupError(404, "NOT_FOUND", "That token is already gone.");
    const me = await tx.user.findUniqueOrThrow({ where: { id: user.id } });
    if (token.userId !== me.id && !isAdministrator(me.role))
      throw forbidden("You can only revoke your own tokens.");
    await tx.apiToken.update({
      where: { id },
      data: { revokedAt: new Date(), revokedById: me.id },
    });
    await audit(tx, {
      actorId: me.id,
      action: "API_TOKEN_REVOKED",
      subject: token.name,
      subjectId: token.id,
      details: token.userId === me.id ? null : `${token.user.name}'s token`,
    });
  });
  return { revoked: true };
}
