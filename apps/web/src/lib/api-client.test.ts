import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiRequest, retryQuery } from "./api-client";

afterEach(() => vi.unstubAllGlobals());
describe("request contract", () => {
  it("preserves pending outcomes without inventing accepted task data", async () => {
    const data = { outcome: "PENDING_APPROVAL", proposalId: "proposal-1" };
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ data, requestId: "request-1" }, { status: 202 }),
        ),
    );
    expect(
      (
        await apiRequest<typeof data>("/api/v1/tasks", {
          method: "POST",
          json: { name: "Review" },
        })
      ).data,
    ).toEqual(data);
  });
  it("retains actionable conflict codes and request IDs", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json(
          {
            error: {
              code: "STALE_PROPOSAL",
              message: "Resubmit the proposal.",
            },
            requestId: "r2",
          },
          { status: 409 },
        ),
      ),
    );
    await expect(apiRequest("/api/v1/proposals/p1")).rejects.toMatchObject({
      status: 409,
      code: "STALE_PROPOSAL",
      requestId: "r2",
    });
  });
  it("rejects an HTML error without leaking its body", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response("<html>internal failure</html>", { status: 502 }),
        ),
    );
    await expect(apiRequest("/api/v1/tasks")).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
      status: 502,
    });
  });
  it("does not send session-bearing requests to an external origin", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(apiRequest("https://example.com/api/tasks")).rejects.toThrow(
      "same-origin",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("forwards cancellation to fetch", async () => {
    const controller = new AbortController();
    const fetchMock = vi
      .fn()
      .mockResolvedValue(Response.json({ data: [], requestId: "r3" }));
    vi.stubGlobal("fetch", fetchMock);
    await apiRequest("/api/v1/tasks", { signal: controller.signal });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/tasks",
      expect.objectContaining({
        signal: controller.signal,
        credentials: "same-origin",
      }),
    );
  });
});

describe("query retries", () => {
  it.each([401, 403, 409, 422, 429])(
    "does not repeat a %i response",
    (status) => {
      expect(retryQuery(0, new ApiError(status, "DENIED", "Denied"))).toBe(
        false,
      );
    },
  );
  it("bounds transient retries and never retries cancelled work", () => {
    expect(retryQuery(0, new ApiError(503, "NOT_READY", "Not ready"))).toBe(
      true,
    );
    expect(retryQuery(2, new TypeError("Network failure"))).toBe(false);
    expect(retryQuery(0, new DOMException("Aborted", "AbortError"))).toBe(
      false,
    );
  });
});
