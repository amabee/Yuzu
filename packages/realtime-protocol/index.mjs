import { createHmac, timingSafeEqual } from "node:crypto";
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function signRealtimeToken(payload, secret) {
  if (!secret || secret.length < 32)
    throw new Error("Realtime secret must contain at least 32 characters.");
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${createHmac("sha256", secret).update(encoded).digest("base64url")}`;
}
export function verifyRealtimeToken(token, secret, purpose, now = Date.now()) {
  if (
    typeof token !== "string" ||
    token.length > 4096 ||
    !secret ||
    secret.length < 32
  )
    throw new Error("Invalid realtime token.");
  const parts = token.split(".");
  if (parts.length !== 2) throw new Error("Invalid realtime token.");
  const [encoded, signature] = parts;
  const expected = createHmac("sha256", secret).update(encoded).digest();
  const received = Buffer.from(signature, "base64url");
  if (
    received.length !== expected.length ||
    !timingSafeEqual(received, expected)
  )
    throw new Error("Invalid realtime signature.");
  const payload = JSON.parse(
    Buffer.from(encoded, "base64url").toString("utf8"),
  );
  const ttl = purpose === "event" ? 15_000 : 65_000;
  if (
    payload.purpose !== purpose ||
    (purpose !== "user" && !uuid.test(payload.boardId)) ||
    !Number.isSafeInteger(payload.expiresAt) ||
    payload.expiresAt <= now ||
    payload.expiresAt > now + ttl
  )
    throw new Error("Invalid or expired realtime token.");
  if (
    (purpose === "board" || purpose === "user") &&
    (typeof payload.userId !== "string" ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(payload.userId))
  )
    throw new Error("Invalid realtime identity.");
  if (
    purpose === "event" &&
    (!uuid.test(payload.eventId) ||
      (payload.taskId !== undefined && !uuid.test(payload.taskId)))
  )
    throw new Error("Invalid realtime event.");
  if (
    purpose === "event" &&
    payload.userIds !== undefined &&
    (!Array.isArray(payload.userIds) ||
      payload.userIds.length > 20 ||
      payload.userIds.some(
        (id) => typeof id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(id),
      ))
  )
    throw new Error("Invalid event recipients.");
  if (
    purpose === "event" &&
    payload.notifyBoard !== undefined &&
    typeof payload.notifyBoard !== "boolean"
  )
    throw new Error("Invalid board delivery flag.");
  return payload;
}
