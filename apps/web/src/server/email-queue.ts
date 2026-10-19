import { createHmac, timingSafeEqual } from "node:crypto";
import { createRecordId, type DatabaseTransaction } from "@yuzu/database";
import { defaultDelivery, INSTANT_DELAY_MS } from "@/lib/email-contract";
import type { EmailDelivery } from "@/lib/email-contract";

/** Each person's delivery choice for one kind, falling back to its default. */
export async function deliveries(
  tx: DatabaseTransaction,
  userIds: string[],
  kind: string,
) {
  const saved = await tx.notificationPreference.findMany({
    where: { userId: { in: userIds }, kind: kind as never },
  });
  // Deactivated people get no email at all.
  const inactive = new Set(
    (
      await tx.user.findMany({
        where: { id: { in: userIds }, deactivatedAt: { not: null } },
        select: { id: true },
      })
    ).map((user) => user.id),
  );
  return new Map<string, EmailDelivery>(
    userIds.map((id) => [
      id,
      inactive.has(id)
        ? "OFF"
        : (saved.find((row) => row.userId === id)?.delivery ??
          defaultDelivery(kind)),
    ]),
  );
}

/**
 * Queues an instant email for each new notification whose recipient wants
 * that kind instantly. The worker sends it after a short delay, and only if
 * the notification is still there and unread.
 */
export async function queueNotificationEmails(
  tx: DatabaseTransaction,
  rows: { id: string; recipientId: string; kind: string; createdAt: Date }[],
) {
  if (!rows.length) return;
  const byKind = new Map<string, typeof rows>();
  for (const row of rows)
    byKind.set(row.kind, [...(byKind.get(row.kind) ?? []), row]);
  const data = [];
  for (const [kind, group] of byKind) {
    const wants = await deliveries(
      tx,
      group.map((row) => row.recipientId),
      kind,
    );
    for (const row of group)
      if (wants.get(row.recipientId) === "INSTANT")
        data.push({
          id: createRecordId(),
          userId: row.recipientId,
          purpose: "instant",
          notificationId: row.id,
          sendAfter: new Date(row.createdAt.getTime() + INSTANT_DELAY_MS),
        });
  }
  if (data.length) await tx.emailMessage.createMany({ data });
}

// ---------- One-click unsubscribe links ----------

function signingKey() {
  const key = process.env.SETTINGS_ENCRYPTION_KEY;
  if (!key) throw new Error("SETTINGS_ENCRYPTION_KEY is required for email.");
  return key;
}

/** A token that lets its holder turn off one kind of email for one person. */
export function unsubscribeToken(userId: string, kind: string) {
  const mac = createHmac("sha256", signingKey())
    .update(`unsubscribe:${userId}:${kind}`)
    .digest("base64url");
  return `${userId}.${kind}.${mac}`;
}

export function readUnsubscribeToken(token: string) {
  const [userId, kind, mac] = token.split(".");
  if (!userId || !kind || !mac) return null;
  const expected = unsubscribeToken(userId, kind).split(".")[2]!;
  const given = Buffer.from(mac);
  const want = Buffer.from(expected);
  return given.length === want.length && timingSafeEqual(given, want)
    ? { userId, kind }
    : null;
}
