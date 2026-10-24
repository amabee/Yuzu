"use client";
import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { io, type Socket } from "socket.io-client";
import { z } from "zod";
import { ApiError, apiRequest } from "@/lib/api-client";

const configuration = z.discriminatedUnion("enabled", [
  z.object({ enabled: z.literal(false) }),
  z.object({
    enabled: z.literal(true),
    url: z.string().url(),
    token: z.string(),
  }),
]);

/** Refreshes the server-rendered navigation (sidebar projects and boards) when
 *  someone else creates, shares, moves or archives something. The event holds
 *  no data; the refresh reads through the normal access scope. */
export function useNavigationLiveSync(principalId: string) {
  const router = useRouter();
  const queryClient = useQueryClient();
  useEffect(() => {
    const abort = new AbortController();
    let socket: Socket | undefined;
    let stopped = false;
    let renewal: ReturnType<typeof setInterval> | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let pending: ReturnType<typeof setTimeout> | undefined;
    const ticket = async () =>
      configuration.parse(
        (
          await apiRequest("/api/v1/realtime/authorize", {
            method: "POST",
            json: {},
            signal: abort.signal,
            cache: "no-store",
          })
        ).data,
      );
    const refresh = () => {
      // Coalesce bursts, such as a reorder followed by a rename.
      clearTimeout(pending);
      pending = setTimeout(() => {
        void queryClient.invalidateQueries({
          queryKey: ["principal", principalId, "task-search", "navigation"],
        });
        router.refresh();
      }, 400);
    };
    const renew = async () => {
      if (stopped || !socket) return;
      try {
        const fresh = await ticket();
        if (stopped || !fresh.enabled) return;
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
        if (error instanceof ApiError && [401, 403].includes(error.status))
          stop();
      }
    };
    const stop = () => {
      stopped = true;
      clearInterval(renewal);
      clearTimeout(retry);
      socket?.disconnect();
    };
    const start = async () => {
      try {
        const config = await ticket();
        if (stopped || !config.enabled) return;
        socket = io(config.url, {
          autoConnect: false,
          forceNew: true,
          transports: ["websocket"],
          auth: { token: config.token },
          reconnectionDelay: 1000,
          reconnectionDelayMax: 10_000,
        });
        socket.on("navigation:changed", refresh);
        socket.on("disconnect", (reason) => {
          if (!stopped && reason === "io server disconnect") void renew();
        });
        renewal = setInterval(() => void renew(), 30_000);
        socket.connect();
      } catch (error) {
        if (error instanceof ApiError && [401, 403].includes(error.status))
          return;
        if (!stopped) retry = setTimeout(() => void start(), 10_000);
      }
    };
    void start();
    return () => {
      stop();
      abort.abort();
      clearTimeout(pending);
      socket?.removeAllListeners();
    };
  }, [principalId, router, queryClient]);
}
