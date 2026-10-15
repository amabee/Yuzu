export const SERVICE_STATUS_EVENT = "yuzu:service-status";
export type ServiceStatusSignal =
  | { kind: "rate-limited"; retryAt: number }
  | { kind: "maintenance" }
  | { kind: "network" };

export function retryDeadline(value: string | null, now = Date.now()): number {
  if (!value?.trim()) return now + 60_000;
  const seconds = Number(value);
  const deadline = Number.isFinite(seconds)
    ? now + Math.max(0, seconds) * 1000
    : Date.parse(value);
  return Number.isFinite(deadline) ? Math.max(now, deadline) : now + 60_000;
}

export function signalServiceStatus(signal: ServiceStatusSignal) {
  if (typeof window !== "undefined")
    window.dispatchEvent(
      new CustomEvent(SERVICE_STATUS_EVENT, { detail: signal }),
    );
}
