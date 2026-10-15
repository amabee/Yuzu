"use client";

import { useEffect, useRef } from "react";
import { useOffline } from "@/hooks/use-offline";
import { OfflineScreen } from "@/components/yuzu/service-screens";

export default function Offline() {
  const { isOffline, isChecking, retry } = useOffline();
  const wasOffline = useRef(false);
  useEffect(() => {
    if (wasOffline.current && !isOffline && !isChecking)
      window.location.replace("/");
    if (isOffline) wasOffline.current = true;
  }, [isOffline, isChecking]);
  return (
    <OfflineScreen
      checking={isChecking}
      onRetry={async () => {
        if (await retry()) window.location.replace("/");
      }}
    />
  );
}
