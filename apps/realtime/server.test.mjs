import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { io } from "socket.io-client";
import { signRealtimeToken } from "@yuzu/realtime-protocol";
import { startRealtimeServer } from "./server.mjs";
const secret = "test-realtime-secret-32-characters-or-more";
const origin = "http://127.0.0.1:3000";
const boardA = "019aa1c0-1111-7111-8111-111111111111";
const boardB = "019aa1c0-2222-7222-8222-222222222222";
const ticket = (boardId, expiresAt = Date.now() + 60_000) =>
  signRealtimeToken(
    { purpose: "board", boardId, userId: "member", expiresAt },
    secret,
  );
const client = (url, token, site = origin) =>
  io(url, {
    transports: ["websocket"],
    auth: { token },
    extraHeaders: { Origin: site },
    reconnection: false,
  });
const start = () =>
  startRealtimeServer({ secret, origin, port: 0, host: "127.0.0.1" });
const url = (runtime) => `http://127.0.0.1:${runtime.server.address().port}`;
const publish = (endpoint, boardId, eventId = crypto.randomUUID()) =>
  fetch(`${endpoint}/events`, {
    method: "POST",
    body: signRealtimeToken(
      { purpose: "event", boardId, eventId, expiresAt: Date.now() + 10_000 },
      secret,
    ),
  });
test("only authorized board viewers receive signed committed-change hints", async () => {
  const runtime = await start();
  const endpoint = url(runtime);
  const a = client(endpoint, ticket(boardA));
  const b = client(endpoint, ticket(boardB));
  try {
    await Promise.all([once(a, "connect"), once(b, "connect")]);
    const aEvents = [],
      bEvents = [];
    a.on("board:changed", (event) => aEvents.push(event));
    b.on("board:changed", (event) => bEvents.push(event));
    b.emit("join", `board:${boardA}`);
    b.emit("board:changed", { boardId: boardA });
    const received = once(a, "board:changed");
    const id = crypto.randomUUID();
    assert.equal((await publish(endpoint, boardA, id)).status, 204);
    assert.deepEqual((await received)[0], { boardId: boardA, eventId: id });
    await publish(endpoint, boardA, id);
    await delay(50);
    assert.equal(aEvents.length, 1);
    assert.equal(bEvents.length, 0);
    assert.equal(
      (
        await fetch(`${endpoint}/events`, {
          method: "POST",
          body: ticket(boardA),
        })
      ).status,
      401,
    );
    assert.equal(
      (await fetch(`${endpoint}/events`, { method: "POST", body: "invalid" }))
        .status,
      401,
    );
    assert.equal(
      (
        await fetch(`${endpoint}/events`, {
          method: "POST",
          body: "x".repeat(4097),
        })
      ).status,
      413,
    );
    const accepted = await new Promise((resolve) =>
      a.emit("board:renew", ticket(boardB), resolve),
    );
    assert.equal(accepted, false);
  } finally {
    a.disconnect();
    b.disconnect();
    await runtime.close();
  }
});
test("invalid, expired and cross-origin connections fail; expired leases disconnect", async () => {
  const runtime = await start();
  const endpoint = url(runtime);
  const clients = [];
  try {
    for (const [token, site] of [
      ["invalid", origin],
      [ticket(boardA, Date.now() - 1), origin],
      [ticket(boardA), "https://untrusted.test"],
    ]) {
      const socket = client(endpoint, token, site);
      clients.push(socket);
      await once(socket, "connect_error");
      assert.equal(socket.connected, false);
    }
    const socket = client(endpoint, ticket(boardA, Date.now() + 250));
    clients.push(socket);
    await once(socket, "connect");
    await once(socket, "disconnect");
    assert.equal(socket.connected, false);
  } finally {
    for (const socket of clients) socket.disconnect();
    await runtime.close();
  }
});
test(
  "Redis carries events between independent realtime instances",
  { skip: !process.env.YUZU_TEST_REDIS_URL },
  async () => {
    const options = {
      secret,
      origin,
      redisUrl: process.env.YUZU_TEST_REDIS_URL,
      port: 0,
      host: "127.0.0.1",
    };
    const first = await startRealtimeServer(options),
      second = await startRealtimeServer(options);
    const socket = client(url(second), ticket(boardA));
    try {
      await once(socket, "connect");
      const received = once(socket, "board:changed");
      assert.equal((await publish(url(first), boardA)).status, 204);
      assert.equal((await received)[0].boardId, boardA);
    } finally {
      socket.disconnect();
      await Promise.all([first.close(), second.close()]);
    }
  },
);

test("user-scoped queue sockets receive only signed signals addressed to that principal", async () => {
  const runtime = await start();
  const endpoint = url(runtime);
  const token = (userId) =>
    signRealtimeToken(
      { purpose: "user", userId, expiresAt: Date.now() + 60_000 },
      secret,
    );
  const member = client(endpoint, token("member")),
    other = client(endpoint, token("other"));
  try {
    await Promise.all([once(member, "connect"), once(other, "connect")]);
    let otherEvents = 0;
    other.on("board:changed", () => otherEvents++);
    const received = once(member, "board:changed");
    const event = {
      purpose: "event",
      boardId: boardA,
      eventId: crypto.randomUUID(),
      userIds: ["member"],
      notifyBoard: false,
      expiresAt: Date.now() + 10_000,
    };
    assert.equal(
      (
        await fetch(`${endpoint}/events`, {
          method: "POST",
          body: signRealtimeToken(event, secret),
        })
      ).status,
      204,
    );
    assert.equal((await received)[0].boardId, boardA);
    await delay(30);
    assert.equal(otherEvents, 0);
  } finally {
    member.disconnect();
    other.disconnect();
    await runtime.close();
  }
});
test("navigation hints reach only the named users and never board rooms", async () => {
  const runtime = await start();
  const endpoint = url(runtime);
  const user = (userId) =>
    signRealtimeToken(
      { purpose: "user", userId, expiresAt: Date.now() + 60_000 },
      secret,
    );
  const named = client(endpoint, user("named_user"));
  const other = client(endpoint, user("other_user"));
  const viewer = client(endpoint, ticket(boardA));
  try {
    await Promise.all([
      once(named, "connect"),
      once(other, "connect"),
      once(viewer, "connect"),
    ]);
    const stray = [];
    other.on("navigation:changed", (event) => stray.push(event));
    viewer.on("navigation:changed", (event) => stray.push(event));
    const received = once(named, "navigation:changed");
    const eventId = crypto.randomUUID();
    const response = await fetch(`${endpoint}/events`, {
      method: "POST",
      body: signRealtimeToken(
        {
          purpose: "event",
          kind: "navigation",
          userIds: ["named_user"],
          eventId,
          expiresAt: Date.now() + 10_000,
        },
        secret,
      ),
    });
    assert.equal(response.status, 204);
    assert.deepEqual((await received)[0], { eventId });
    await delay(50);
    assert.equal(stray.length, 0);
  } finally {
    named.close();
    other.close();
    viewer.close();
    await runtime.close();
  }
});
