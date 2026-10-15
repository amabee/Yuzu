"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Dialog } from "radix-ui";
import { useRouter } from "next/navigation";
import {
  SERVICE_STATUS_EVENT,
  type ServiceStatusSignal,
} from "@/lib/service-status";
import {
  MaintenanceScreen,
  OfflineScreen,
  RateLimitedScreen,
} from "./service-screens";

export function ServiceStatusRuntime() {
  const router = useRouter();
  const [offline, setOffline] = useState(false);
  const [maintenance, setMaintenance] = useState(false);
  const [retryAt, setRetryAt] = useState<number | null>(null);
  const [checking, setChecking] = useState(false);
  const probing = useRef(false);
  const checkConnection = useCallback(async () => {
    if (probing.current) return;
    probing.current = true;
    setChecking(true);
    try {
      const response = await fetch("/api/health/ready", {
        cache: "no-store",
        signal: AbortSignal.timeout(5000),
      });
      setOffline(!response.ok);
    } catch {
      setOffline(true);
    } finally {
      probing.current = false;
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    const disconnected = () => setOffline(true);
    const reconnected = () => {
      void checkConnection();
    };
    const receive = (event: Event) => {
      const signal = (event as CustomEvent<ServiceStatusSignal>).detail;
      if (signal.kind === "rate-limited")
        setRetryAt((previous) => Math.max(previous ?? 0, signal.retryAt));
      else if (signal.kind === "maintenance") setMaintenance(true);
      else void checkConnection();
    };
    window.addEventListener("offline", disconnected);
    window.addEventListener("online", reconnected);
    window.addEventListener(SERVICE_STATUS_EVENT, receive);
    const initialCheck = window.setTimeout(() => {
      if (!navigator.onLine) void checkConnection();
    }, 0);
    return () => {
      window.clearTimeout(initialCheck);
      window.removeEventListener("offline", disconnected);
      window.removeEventListener("online", reconnected);
      window.removeEventListener(SERVICE_STATUS_EVENT, receive);
    };
  }, [checkConnection]);

  useEffect(() => {
    if (!offline) return;
    const timer = window.setInterval(() => {
      void checkConnection();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [offline, checkConnection]);

  async function checkMaintenance() {
    setChecking(true);
    try {
      const response = await fetch("/api/v1/status", {
        cache: "no-store",
        signal: AbortSignal.timeout(5000),
      });
      if (response.ok && (await response.json()).data.maintenance === false) {
        setMaintenance(false);
        router.refresh();
      }
    } catch {
      setOffline(true);
    } finally {
      setChecking(false);
    }
  }

  const open = offline || maintenance || retryAt !== null;
  return (
    <Dialog.Root open={open}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[100] bg-background" />
        <Dialog.Content
          className="fixed inset-0 z-[101] overflow-y-auto bg-background outline-none"
          aria-describedby={undefined}
          onEscapeKeyDown={(event) => event.preventDefault()}
          onPointerDownOutside={(event) => event.preventDefault()}
        >
          <Dialog.Title className="sr-only">
            {offline
              ? "Connection unavailable"
              : maintenance
                ? "Maintenance in progress"
                : "Request limit reached"}
          </Dialog.Title>
          {offline ? (
            <OfflineScreen
              checking={checking}
              onRetry={() => void checkConnection()}
            />
          ) : maintenance ? (
            <MaintenanceScreen
              checking={checking}
              onRetry={() => void checkMaintenance()}
            />
          ) : (
            <RateLimitedScreen
              retryAt={retryAt ?? 0}
              onRetry={() => setRetryAt(null)}
            />
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
