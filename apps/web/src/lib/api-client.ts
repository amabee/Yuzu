import { retryDeadline, signalServiceStatus } from "./service-status";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public requestId?: string,
    /** Extra structure some errors carry, like the deals blocking a change. */
    public details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export type ApiResponse<T> = {
  data: T;
  meta?: { nextCursor: string | null };
  requestId: string;
};
type RequestOptions = Omit<RequestInit, "body"> & {
  json?: unknown;
  body?: BodyInit;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export async function apiRequest<T>(
  path: string,
  options: RequestOptions = {},
): Promise<ApiResponse<T>> {
  if (!path.startsWith("/api/") || path.startsWith("//")) {
    throw new Error("API requests must use a same-origin /api/ path.");
  }
  const { json, ...requestOptions } = options;
  const headers = new Headers(requestOptions.headers);
  headers.set("Accept", "application/json");
  if (json !== undefined) headers.set("Content-Type", "application/json");
  const response = await fetch(path, {
    ...requestOptions,
    credentials: "same-origin",
    headers,
    body: json !== undefined ? JSON.stringify(json) : requestOptions.body,
  }).catch((error: unknown) => {
    if (error instanceof TypeError) signalServiceStatus({ kind: "network" });
    throw error;
  });
  if (response.status === 429)
    signalServiceStatus({
      kind: "rate-limited",
      retryAt: retryDeadline(response.headers.get("Retry-After")),
    });
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ApiError(
      response.status,
      "INVALID_RESPONSE",
      "The server returned an unreadable response.",
    );
  }
  if (!response.ok) {
    const error =
      isRecord(payload) && isRecord(payload.error) ? payload.error : {};
    if (response.status === 503 && error.code === "MAINTENANCE")
      signalServiceStatus({ kind: "maintenance" });
    throw new ApiError(
      response.status,
      typeof error.code === "string" ? error.code : "REQUEST_FAILED",
      typeof error.message === "string"
        ? error.message
        : "The request could not be completed.",
      isRecord(payload) && typeof payload.requestId === "string"
        ? payload.requestId
        : undefined,
      error.details,
    );
  }
  if (
    !isRecord(payload) ||
    !("data" in payload) ||
    typeof payload.requestId !== "string"
  ) {
    throw new ApiError(
      response.status,
      "INVALID_RESPONSE",
      "The server returned an unexpected response.",
    );
  }
  // Feature hooks validate their data schema before consuming typed domain records.
  return payload as ApiResponse<T>;
}

export function retryQuery(failureCount: number, error: Error): boolean {
  if (error.name === "AbortError" || failureCount >= 2) return false;
  if (error instanceof ApiError)
    return (
      error.status >= 500 &&
      error.code !== "INVALID_RESPONSE" &&
      error.code !== "MAINTENANCE"
    );
  return error instanceof TypeError; // Fetch network failure, not arbitrary application errors.
}
