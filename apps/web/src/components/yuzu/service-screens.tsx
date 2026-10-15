"use client";

import { useEffect, useState } from "react";
import { ErrorShell, btnPrimary, btnSecondary } from "./error-shell";

export function RateLimitedScreen({
  retryAt = 0,
  onRetry,
}: {
  retryAt?: number;
  onRetry: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const remaining = Math.max(0, Math.ceil((retryAt - now) / 1000));
  return (
    <ErrorShell
      mood="dizzy"
      code="Error 429"
      title="Whoa, slow down a little"
      description="Too many requests came in too quickly and Yuzu got dizzy. Take a short breather, then try again."
    >
      <button
        type="button"
        disabled={remaining > 0}
        onClick={onRetry}
        className={`${btnPrimary} disabled:cursor-wait disabled:opacity-60`}
      >
        {remaining ? `Try again in ${remaining}s` : "Try again"}
      </button>
    </ErrorShell>
  );
}

export function MaintenanceScreen({
  onRetry,
  checking = false,
}: {
  onRetry: () => void;
  checking?: boolean;
}) {
  return (
    <ErrorShell
      mood="builder"
      code="Scheduled maintenance"
      title="We'll be right back"
      description="Yuzu is getting a quick tune-up. Your open work will stay here while changes are paused."
    >
      <button
        type="button"
        className={btnPrimary}
        onClick={onRetry}
        disabled={checking}
      >
        {checking ? "Checking…" : "Check again"}
      </button>
      <a href="/sign-in" className={btnSecondary}>
        Administrator sign in
      </a>
    </ErrorShell>
  );
}

export function OfflineScreen({
  onRetry,
  checking = false,
}: {
  onRetry: () => void;
  checking?: boolean;
}) {
  return (
    <ErrorShell
      mood="cold"
      code="You're offline"
      title="No connection"
      description="Yuzu can't reach the server right now. Check your network connection; we'll reconnect when it's available."
    >
      <button
        type="button"
        onClick={onRetry}
        disabled={checking}
        className={btnPrimary}
      >
        {checking ? "Checking…" : "Retry connection"}
      </button>
    </ErrorShell>
  );
}
