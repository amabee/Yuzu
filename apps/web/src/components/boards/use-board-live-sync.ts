"use client";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { io, type Socket } from "socket.io-client";
import { z } from "zod";
import { ApiError, apiRequest } from "@/lib/api-client";
import { createLiveRefreshQueue } from "@/lib/live-refresh-queue";
const configuration = z.discriminatedUnion("enabled", [
  z.object({ enabled: z.literal(false) }),
  z.object({
    enabled: z.literal(true),
    url: z.string().url(),
    token: z.string(),
  }),
]);
const eventSchema = z.object({
  boardId: z.string().uuid(),
  eventId: z.string().uuid(),
  taskId: z.string().uuid().optional(),
});
function useLiveSync(boardId: string | undefined, principalId: string) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<
    "connecting" | "live" | "reconnecting" | "fallback"
  >("connecting");
  useEffect(() => {
    const queryKey = boardId
      ? ["principal", principalId, "boards", boardId]
      : ["principal", principalId, "approvals"];
    const abort = new AbortController();
    let socket: Socket | undefined;
    let stopped = false;
    let renewing = false;
    let renewal: ReturnType<typeof setInterval> | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const seen = new Set<string>();
    const queue = createLiveRefreshQueue(
      () =>
        Boolean(
          queryClient.isMutating({ mutationKey: queryKey }) ||
          queryClient.isMutating({
            mutationKey: ["principal", principalId, "notifications"],
          }),
        ),
      () =>
        Promise.all([
          queryClient.invalidateQueries({ queryKey }, { cancelRefetch: false }),
          queryClient.invalidateQueries(
            { queryKey: ["principal", principalId, "approvals"] },
            { cancelRefetch: false },
          ),
          queryClient.invalidateQueries(
            { queryKey: ["principal", principalId, "task-comments"] },
            { cancelRefetch: false },
          ),
          queryClient.invalidateQueries(
            { queryKey: ["principal", principalId, "task-files"] },
            { cancelRefetch: false },
          ),
          queryClient.invalidateQueries(
            { queryKey: ["principal", principalId, "notifications"] },
            { cancelRefetch: false },
          ),
        ]),
    );
    const changed = queue.changed;
    const ticket = async () =>
      configuration.parse(
        (
          await apiRequest("/api/v1/realtime/authorize", {
            method: "POST",
            json: boardId ? { boardId } : {},
            signal: abort.signal,
            cache: "no-store",
          })
        ).data,
      );
    const failed = (error: unknown) => {
      if (stopped) return;
      if (error instanceof ApiError && [401, 403, 404].includes(error.status)) {
        stopped = true;
        socket?.disconnect();
        clearInterval(renewal);
        clearTimeout(retry);
        queue.dispose();
        setStatus("fallback");
        void queryClient.invalidateQueries({ queryKey });
        return;
      }
      setStatus("reconnecting");
    };
    const renew = async () => {
      if (stopped || renewing) return;
      renewing = true;
      try {
        const fresh = await ticket();
        if (stopped) return;
        if (!fresh.enabled) {
          socket?.disconnect();
          clearInterval(renewal);
          setStatus("fallback");
          return;
        }
        if (!socket) {
          await initialize(fresh);
          return;
        }
        socket.auth = { token: fresh.token };
        if (socket.connected)
          socket
            .timeout(5000)
            .emit(
              "board:renew",
              fresh.token,
              (error: Error | null, accepted: boolean) => {
                if (!stopped && (error || !accepted)) {
                  socket?.disconnect();
                  socket?.connect();
                }
              },
            );
        else if (!socket.active) socket.connect();
      } catch (error) {
        failed(error);
      } finally {
        renewing = false;
      }
    };
    const initialize = async (
      initial?: Extract<z.infer<typeof configuration>, { enabled: true }>,
    ) => {
      try {
        const config = initial ?? (await ticket());
        if (stopped) return;
        if (!config.enabled) {
          setStatus("fallback");
          return;
        }
        socket = io(config.url, {
          autoConnect: false,
          forceNew: true,
          transports: ["websocket"],
          auth: { token: config.token },
          reconnectionDelay: 1000,
          reconnectionDelayMax: 10_000,
        });
        socket.on("connect", () => {
          setStatus("live");
          changed();
        });
        socket.on("disconnect", (reason) => {
          if (stopped) return;
          setStatus("reconnecting");
          if (reason === "io server disconnect") void renew();
        });
        socket.on("connect_error", () => {
          if (stopped) return;
          setStatus("reconnecting");
          if (!socket?.active) {
            clearTimeout(retry);
            retry = setTimeout(() => void renew(), 2000);
          }
        });
        socket.on("board:changed", (value) => {
          const parsed = eventSchema.safeParse(value);
          if (
            !parsed.success ||
            (boardId !== undefined && parsed.data.boardId !== boardId) ||
            seen.has(parsed.data.eventId)
          )
            return;
          seen.add(parsed.data.eventId);
          if (seen.size > 100) seen.delete(seen.values().next().value!);
          changed();
        });
        renewal = setInterval(() => void renew(), 30_000);
        socket.connect();
      } catch (error) {
        failed(error);
        if (!stopped) retry = setTimeout(() => void initialize(), 10_000);
      }
    };
    void initialize();
    return () => {
      stopped = true;
      abort.abort();
      clearInterval(renewal);
      clearTimeout(retry);
      queue.dispose();
      socket?.removeAllListeners();
      socket?.disconnect();
    };
  }, [boardId, principalId, queryClient]);
  return { status, syncInterval: status === "live" ? 60_000 : 15_000 };
}

export function useBoardLiveSync(boardId: string, principalId: string) {
  return useLiveSync(boardId, principalId);
}
export function useApprovalLiveSync(principalId: string) {
  return useLiveSync(undefined, principalId);
}
