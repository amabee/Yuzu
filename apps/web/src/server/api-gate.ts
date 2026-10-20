import { randomBytes } from "node:crypto";

/** Request header the proxy sets on API-token requests it has allowed. */
export const API_GATE_HEADER = "x-yuzu-api-gate";

/**
 * A per-process secret shared by the proxy and route handlers (they run in
 * the same Node process). A client can't forge the gate header without it,
 * so a token only works where the proxy has checked the endpoint.
 */
export function gateSecret(): string {
  const store = globalThis as typeof globalThis & { __yuzuApiGate?: string };
  store.__yuzuApiGate ??= randomBytes(24).toString("base64url");
  return store.__yuzuApiGate;
}

export const bearerToken = (headers: Headers) => {
  const value = headers.get("authorization");
  return value?.startsWith("Bearer ") ? value.slice(7).trim() : null;
};

/** "read" or "write" if the proxy allowed this token request, else null. */
export function gatedAccess(headers: Headers): "read" | "write" | null {
  const [access, secret] = (headers.get(API_GATE_HEADER) ?? "").split(".");
  if (secret !== gateSecret()) return null;
  return access === "read" || access === "write" ? access : null;
}
