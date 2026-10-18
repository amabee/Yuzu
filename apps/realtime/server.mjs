import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { Server } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import { createClient } from "redis";
import { verifyRealtimeToken } from "@yuzu/realtime-protocol";

export async function startRealtimeServer({
  secret,
  origin,
  redisUrl,
  port = 3001,
  host = "0.0.0.0",
}) {
  if (!secret || secret.length < 32)
    throw new Error("Configure REALTIME_SECRET with at least 32 characters.");
  const allowedOrigin = new URL(origin).origin;
  let pub, sub;
  const seen = new Map();
  const server = createServer(async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    if (request.method === "GET" && request.url === "/health") {
      response.writeHead(!pub || (pub.isReady && sub.isReady) ? 200 : 503);
      response.end("realtime");
      return;
    }
    if (request.method !== "POST" || request.url !== "/events") {
      response.writeHead(404);
      response.end();
      return;
    }
    try {
      let body = "";
      for await (const chunk of request) {
        body += chunk;
        if (Buffer.byteLength(body) > 4096) {
          response.writeHead(413);
          response.end();
          return;
        }
      }
      const event = verifyRealtimeToken(body, secret, "event");
      if (pub && (!pub.isReady || !sub.isReady)) {
        response.writeHead(503);
        response.end();
        return;
      }
      while (seen.size) {
        const [id, expiresAt] = seen.entries().next().value;
        if (expiresAt > Date.now() && seen.size < 20_000) break;
        seen.delete(id);
      }
      if (!seen.has(event.eventId)) {
        seen.set(event.eventId, event.expiresAt);
        if (event.kind === "navigation")
          io.to(event.userIds.map((id) => `user:${id}`)).emit(
            "navigation:changed",
            { eventId: event.eventId },
          );
        else
          io.to([
            ...(event.notifyBoard !== false ? [`board:${event.boardId}`] : []),
            ...(event.userIds ?? []).map((id) => `user:${id}`),
          ]).emit("board:changed", {
            boardId: event.boardId,
            eventId: event.eventId,
            ...(event.taskId ? { taskId: event.taskId } : {}),
          });
      }
      response.writeHead(204);
      response.end();
    } catch {
      response.writeHead(401);
      response.end();
    }
  });
  server.requestTimeout = 10_000;
  server.headersTimeout = 15_000;
  const io = new Server(server, {
    serveClient: false,
    transports: ["websocket"],
    maxHttpBufferSize: 4096,
    cors: { origin: allowedOrigin },
    allowRequest: (request, callback) =>
      callback(null, request.headers.origin === allowedOrigin),
  });
  if (redisUrl) {
    pub = createClient({ url: redisUrl });
    sub = pub.duplicate();
    pub.on("error", () =>
      console.error("Realtime Redis publisher unavailable."),
    );
    sub.on("error", () =>
      console.error("Realtime Redis subscriber unavailable."),
    );
    await Promise.all([pub.connect(), sub.connect()]);
    io.adapter(createAdapter(pub, sub));
  }
  io.use((socket, next) => {
    try {
      try {
        socket.data.ticket = verifyRealtimeToken(
          socket.handshake.auth.token,
          secret,
          "board",
        );
      } catch {
        socket.data.ticket = verifyRealtimeToken(
          socket.handshake.auth.token,
          secret,
          "user",
        );
      }
      next();
    } catch {
      next(new Error("Board authorization required."));
    }
  });
  io.on("connection", (socket) => {
    const ticket = socket.data.ticket;
    if (ticket.purpose === "board") socket.join(`board:${ticket.boardId}`);
    socket.join(`user:${ticket.userId}`);
    let expiry;
    let renewedAt = 0;
    const scheduleExpiry = (expiresAt) => {
      clearTimeout(expiry);
      expiry = setTimeout(
        () => socket.disconnect(true),
        Math.max(1, expiresAt - Date.now()),
      );
      expiry.unref();
    };
    scheduleExpiry(ticket.expiresAt);
    socket.on("board:renew", (token, acknowledge) => {
      if (typeof acknowledge !== "function") return;
      try {
        if (Date.now() - renewedAt < 5000)
          throw new Error("Renewal too frequent.");
        const fresh = verifyRealtimeToken(token, secret, ticket.purpose);
        if (fresh.boardId !== ticket.boardId || fresh.userId !== ticket.userId)
          throw new Error("Ticket scope changed.");
        renewedAt = Date.now();
        scheduleExpiry(fresh.expiresAt);
        acknowledge(true);
      } catch {
        acknowledge(false);
      }
    });
    socket.on("disconnect", () => clearTimeout(expiry));
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, resolve);
  });
  return {
    io,
    server,
    close: async () => {
      await new Promise((resolve) => io.close(resolve));
      await Promise.all([pub?.close(), sub?.close()]);
    },
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const runtime = await startRealtimeServer({
    secret: process.env.REALTIME_SECRET,
    origin: process.env.REALTIME_ALLOWED_ORIGIN,
    redisUrl: process.env.REDIS_URL,
    port: Number(process.env.PORT ?? 3001),
  });
  console.log("Yuzu realtime service listening.");
  for (const signal of ["SIGTERM", "SIGINT"])
    process.once(signal, () => {
      void runtime.close().then(() => process.exit(0));
    });
}
