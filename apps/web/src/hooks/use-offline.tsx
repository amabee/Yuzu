"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  SERVICE_STATUS_EVENT,
  type ServiceStatusSignal,
} from "@/lib/service-status";

type OfflineState = {
  isOffline: boolean;
  isChecking: boolean;
  retry: () => Promise<boolean>;
};
const OfflineContext = createContext<OfflineState | null>(null);

/** One shared probe and listener set for all useOffline consumers. */
export function OfflineProvider({ children }: { children: ReactNode }) {
  const [isOffline, setIsOffline] = useState(false);
  const [isChecking, setIsChecking] = useState(false);
  const inFlight = useRef<Promise<boolean> | null>(null);
  const controller = useRef<AbortController | null>(null);

  const retry = useCallback((): Promise<boolean> => {
    if (inFlight.current) return inFlight.current;
    const probe = new AbortController();
    controller.current = probe;
    setIsChecking(true);
    const timeout = window.setTimeout(() => probe.abort(), 5000);
    inFlight.current = (async () => {
      try {
        // Server reachability matters even if the browser reports no internet.
        const response = await fetch("/api/health/ready", {
          cache: "no-store",
          signal: probe.signal,
        });
        if (controller.current === probe) setIsOffline(!response.ok);
        return response.ok;
      } catch {
        if (controller.current === probe) setIsOffline(true);
        return false;
      } finally {
        window.clearTimeout(timeout);
        if (controller.current === probe) {
          inFlight.current = null;
          controller.current = null;
          setIsChecking(false);
        }
      }
    })();
    return inFlight.current;
  }, []);

  useEffect(() => {
    const check = () => {
      void retry();
    };
    const receive = (event: Event) => {
      if ((event as CustomEvent<ServiceStatusSignal>).detail.kind === "network")
        check();
    };
    window.addEventListener("offline", check);
    window.addEventListener("online", check);
    window.addEventListener(SERVICE_STATUS_EVENT, receive);
    const initialCheck = window.setTimeout(() => {
      if (!navigator.onLine) check();
    }, 0);
    return () => {
      window.clearTimeout(initialCheck);
      window.removeEventListener("offline", check);
      window.removeEventListener("online", check);
      window.removeEventListener(SERVICE_STATUS_EVENT, receive);
      const pending = controller.current;
      controller.current = null;
      inFlight.current = null;
      pending?.abort();
    };
  }, [retry]);

  useEffect(() => {
    if (!isOffline) return;
    const timer = window.setInterval(() => {
      void retry();
    }, 5000);
    return () => window.clearInterval(timer);
  }, [isOffline, retry]);

  return (
    <OfflineContext.Provider value={{ isOffline, isChecking, retry }}>
      {children}
    </OfflineContext.Provider>
  );
}

/** Reports Yuzu server availability, not a guarantee of public internet access. */
export function useOffline() {
  const state = useContext(OfflineContext);
  if (!state)
    throw new Error("useOffline must be used inside OfflineProvider.");
  return state;
}
