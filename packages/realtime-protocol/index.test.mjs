import { test } from "node:test";
import assert from "node:assert/strict";
import { signRealtimeToken, verifyRealtimeToken } from "./index.mjs";
const secret = "test-realtime-secret-32-characters-or-more";
const boardId = "019aa1c0-1111-7111-8111-111111111111";
const ticket = {
  purpose: "board",
  boardId,
  userId: "legacy_member",
  expiresAt: Date.now() + 60_000,
};
test("board tickets retain verified scope and reject tampering, wrong secrets and expiry", () => {
  const token = signRealtimeToken(ticket, secret);
  assert.deepEqual(verifyRealtimeToken(token, secret, "board"), ticket);
  assert.throws(() => verifyRealtimeToken(token + "x", secret, "board"));
  assert.throws(() =>
    verifyRealtimeToken(
      token,
      "a-different-secret-32-characters-or-more",
      "board",
    ),
  );
  assert.throws(() =>
    verifyRealtimeToken(token, secret, "board", ticket.expiresAt),
  );
});
test("board tickets cannot publish events and event tokens cannot subscribe", () => {
  assert.throws(() =>
    verifyRealtimeToken(signRealtimeToken(ticket, secret), secret, "event"),
  );
  const event = {
    purpose: "event",
    boardId,
    eventId: crypto.randomUUID(),
    expiresAt: Date.now() + 10_000,
  };
  assert.deepEqual(
    verifyRealtimeToken(signRealtimeToken(event, secret), secret, "event"),
    event,
  );
  assert.throws(() =>
    verifyRealtimeToken(signRealtimeToken(event, secret), secret, "board"),
  );
});
test("invalid scopes, excessive lifetimes, oversized tokens and short keys fail closed", () => {
  for (const patch of [
    { boardId: "not-a-board" },
    { userId: "member with spaces" },
    { expiresAt: Date.now() + 300_000 },
  ])
    assert.throws(() =>
      verifyRealtimeToken(
        signRealtimeToken({ ...ticket, ...patch }, secret),
        secret,
        "board",
      ),
    );
  assert.throws(() => verifyRealtimeToken("a".repeat(4097), secret, "board"));
  assert.throws(() => signRealtimeToken(ticket, "short"));
});

test("user tickets are identity-scoped and cannot publish or masquerade as board tickets", () => {
  const payload = {
    purpose: "user",
    userId: "legacy_member",
    expiresAt: Date.now() + 60_000,
  };
  const token = signRealtimeToken(payload, secret);
  assert.deepEqual(verifyRealtimeToken(token, secret, "user"), payload);
  assert.throws(() => verifyRealtimeToken(token, secret, "board"));
  assert.throws(() => verifyRealtimeToken(token, secret, "event"));
});
