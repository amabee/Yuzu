import { describe, expect, it, vi, afterEach } from "vitest";
import { retryDeadline, SERVICE_STATUS_EVENT } from "./service-status";
import { apiRequest, ApiError, retryQuery } from "./api-client";

afterEach(() => vi.unstubAllGlobals());

describe("service recovery", () => {
  it("respects Retry-After seconds and dates, safely falling back for malformed values", () => {
    const now = Date.parse("2026-10-15T00:00:00Z");
    expect(retryDeadline("120", now)).toBe(now + 120000);
    expect(retryDeadline("Thu, 15 Oct 2026 00:02:00 GMT", now)).toBe(
      now + 120000,
    );
    expect(retryDeadline("-5", now)).toBe(now);
    expect(retryDeadline("broken", now)).toBe(now + 60000);
    expect(retryDeadline(null, now)).toBe(now + 60000);
  });

  it("signals cooldowns without swallowing the structured API error", async () => {
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", { dispatchEvent });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json(
            {
              error: { code: "RATE_LIMITED", message: "Wait." },
              requestId: "r1",
            },
            { status: 429, headers: { "Retry-After": "120" } },
          ),
        ),
    );
    const start = Date.now();
    await expect(apiRequest("/api/v1/session/sign-in")).rejects.toMatchObject({
      status: 429,
      code: "RATE_LIMITED",
      requestId: "r1",
    });
    const event = dispatchEvent.mock.calls[0][0] as CustomEvent;
    expect(event.type).toBe(SERVICE_STATUS_EVENT);
    expect(event.detail.kind).toBe("rate-limited");
    expect(event.detail.retryAt).toBeGreaterThanOrEqual(start + 120000);
  });

  it("signals maintenance and never automatically retries a maintenance response", async () => {
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", { dispatchEvent });
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json(
            {
              error: { code: "MAINTENANCE", message: "Paused." },
              requestId: "r2",
            },
            { status: 503 },
          ),
        ),
    );
    await expect(apiRequest("/api/v1/boards/state")).rejects.toMatchObject({
      code: "MAINTENANCE",
    });
    expect((dispatchEvent.mock.calls[0][0] as CustomEvent).detail).toEqual({
      kind: "maintenance",
    });
    expect(retryQuery(0, new ApiError(503, "MAINTENANCE", "Paused."))).toBe(
      false,
    );
  });

  it("does not turn aborted requests into connection errors", async () => {
    const dispatchEvent = vi.fn();
    vi.stubGlobal("window", { dispatchEvent });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new DOMException("Cancelled", "AbortError")),
    );
    await expect(apiRequest("/api/v1/boards/state")).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(dispatchEvent).not.toHaveBeenCalled();
  });
});
