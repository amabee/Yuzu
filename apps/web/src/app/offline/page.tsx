"use client";

import { useCallback, useEffect, useState } from "react";
import { OfflineScreen } from "@/components/yuzu/service-screens";

export default function Offline() {
  const [checking, setChecking] = useState(false);
  const retry = useCallback(async () => {
    setChecking(true);
    try {
      const response = await fetch("/api/health/ready", {
        cache: "no-store",
        signal: AbortSignal.timeout(5000),
      });
      if (response.ok) window.location.replace("/");
    } catch {
      /* Remain here until Yuzu is reachable. */
    } finally {
      setChecking(false);
    }
  }, []);
  useEffect(() => {
    const back = () => {
      void retry();
    };
    window.addEventListener("online", back);
    return () => window.removeEventListener("online", back);
  }, [retry]);
  return <OfflineScreen checking={checking} onRetry={() => void retry()} />;
}
