import { randomBytes } from "node:crypto";
import { after } from "next/server";
import { hashPassword } from "better-auth/crypto";
import { z } from "zod";
import { getDatabase, type DatabaseTransaction } from "@yuzu/database";
import {
  recoveryRequestSchema,
  recoveryResetSchema,
} from "@/lib/recovery-contract";
import { allowRecoveryRequest, allowRecoveryReset } from "./auth-rate-limit";
import { configuredOrigin, digest, SetupError } from "./setup/security";
import { sendVerifiedEmail, verifiedEmailSettings } from "./email";

const PREFIX = "yuzu-password-reset:";
const payloadSchema = z.strictObject({
  userId: z.string(),
  email: z.email(),
  credentialDigest: z.string(),
  ready: z.boolean(),
});
const unavailable = () =>
  new SetupError(
    410,
    "RESET_UNAVAILABLE",
    "This recovery link has expired, was replaced, or has already been used. Request a new link.",
  );

export async function requestRecovery(input: unknown) {
  const { email } = recoveryRequestSchema.parse(input);
  const settings = await verifiedEmailSettings();
  if (!(await allowRecoveryRequest(email)))
    throw new SetupError(
      429,
      "WAIT_TO_RESEND",
      "Wait one minute before requesting another recovery email.",
    );
  const token = randomBytes(32).toString("base64url");
  const db = getDatabase();
  const user = await db.user.findUnique({
    where: { email },
    include: { accounts: { where: { providerId: "credential" } } },
  });
  const credential = user?.accounts.find((account) => account.password);
  if (!user || !credential?.password) return { saved: true };
  const id = `${PREFIX}${user.id}`;
  const identifier = `${PREFIX}${digest(token)}`;
  const payload = {
    userId: user.id,
    email,
    credentialDigest: digest(credential.password),
    ready: false,
  };
  const data = {
    identifier,
    value: JSON.stringify(payload),
    expiresAt: new Date(Date.now() + 30 * 60_000),
  };
  await db.verification.upsert({
    where: { id },
    create: { id, ...data },
    update: data,
  });
  // Deliver after responding: SMTP timing and delivery errors must not reveal account existence.
  // A link is usable only after SMTP accepts it. A newer request replaces the previous digest.
  after(async () => {
    try {
      await sendVerifiedEmail(
        settings,
        email,
        `Reset your ${settings.name} password`,
        `A password reset was requested for your ${settings.name} account.\n\n${configuredOrigin()}/reset-password#${token}\n\nThis link expires in 30 minutes and can be used once. Resetting your password signs you out of all sessions. If you did not request this, you can ignore this email.`,
      );
      await db.verification.updateMany({
        where: { id, identifier },
        data: { value: JSON.stringify({ ...payload, ready: true }) },
      });
    } catch {
      await db.verification.deleteMany({ where: { id, identifier } });
      console.error(
        JSON.stringify({ event: "password_recovery_delivery_failed" }),
      );
    }
  });
  return { saved: true };
}

async function resetRecord(tx: DatabaseTransaction, tokenDigest: string) {
  const record = await tx.verification.findFirst({
    where: {
      identifier: `${PREFIX}${tokenDigest}`,
      id: { startsWith: PREFIX },
    },
  });
  if (!record || record.expiresAt <= new Date()) throw unavailable();
  let payload: z.infer<typeof payloadSchema>;
  try {
    payload = payloadSchema.parse(JSON.parse(record.value));
  } catch {
    throw unavailable();
  }
  if (!payload.ready || record.id !== `${PREFIX}${payload.userId}`)
    throw unavailable();
  const user = await tx.user.findUnique({ where: { id: payload.userId } });
  const account = await tx.account.findFirst({
    where: { userId: payload.userId, providerId: "credential" },
  });
  // Email or password changes invalidate previously issued recovery links.
  if (
    !user ||
    user.email !== payload.email ||
    !account?.password ||
    digest(account.password) !== payload.credentialDigest
  )
    throw unavailable();
  return { record, user, account };
}

export async function finishRecovery(input: unknown) {
  const { token, password } = recoveryResetSchema.parse(input);
  await verifiedEmailSettings();
  if (!(await allowRecoveryReset(token)))
    throw new SetupError(
      429,
      "TOO_MANY_ATTEMPTS",
      "Too many recovery attempts. Try again later.",
    );
  const db = getDatabase();
  const tokenDigest = digest(token);
  await resetRecord(db, tokenDigest);
  const passwordHash = await hashPassword(password);
  for (let attempt = 0; ; attempt++) {
    try {
      await db.$transaction(
        async (tx) => {
          const { record, user, account } = await resetRecord(tx, tokenDigest);
          await tx.account.update({
            where: { id: account.id },
            data: { password: passwordHash },
          });
          await tx.user.update({
            where: { id: user.id },
            data: { emailVerified: true },
          });
          await tx.session.deleteMany({ where: { userId: user.id } });
          await tx.verification.delete({ where: { id: record.id } });
        },
        { isolationLevel: "Serializable" },
      );
      return { saved: true };
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "P2034" &&
        attempt < 2
      )
        continue;
      throw error;
    }
  }
}
