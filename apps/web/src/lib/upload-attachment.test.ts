import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { downloadTaskFile } from "./upload-attachment";

const click = vi.fn();
let saved: Blob | undefined;
beforeEach(() => {
  vi.useFakeTimers();
  click.mockClear();
  saved = undefined;
  vi.stubGlobal("document", {
    createElement: () => ({ click, href: "", download: "" }),
  });
  vi.stubGlobal("window", { setTimeout });
  vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
    saved = blob as Blob;
    return "blob:test";
  });
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("download transfer progress", () => {
  it("reports actual received bytes and hands the complete file to the browser", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode("Yuzu "));
              controller.enqueue(new TextEncoder().encode("notes"));
              controller.close();
            },
          }),
          { headers: { "Content-Length": "10", "Content-Type": "text/plain" } },
        ),
      ),
    );
    const progress = vi.fn();
    await downloadTaskFile("id", "notes.txt", progress);
    expect(progress.mock.calls).toEqual([
      [0, 10],
      [5, 10],
      [10, 10],
    ]);
    expect(await saved?.text()).toBe("Yuzu notes");
    expect(saved?.type).toBe("text/plain");
    expect(click).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:test");
  });
  it.each<Record<string, string>>([
    {},
    { "Content-Encoding": "gzip", "Content-Length": "3" },
  ])(
    "does not invent a total for missing or encoded lengths: %j",
    async (headers) => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(new Response("decoded notes", { headers })),
      );
      const progress = vi.fn();
      await downloadTaskFile("id", "notes.txt", progress);
      expect(progress.mock.calls[0]).toEqual([0, undefined]);
      expect(progress.mock.lastCall).toEqual([13, undefined]);
      expect(click).toHaveBeenCalledOnce();
    },
  );
  it("rejects truncated transfers instead of saving a partial file", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response("short", { headers: { "Content-Length": "10" } }),
        ),
    );
    await expect(downloadTaskFile("id", "notes.txt")).rejects.toThrow(
      "interrupted",
    );
    expect(click).not.toHaveBeenCalled();
  });
  it("propagates failures while streaming without saving partial data", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          new ReadableStream({
            start(controller) {
              controller.error(new Error("Connection lost"));
            },
          }),
        ),
      ),
    );
    await expect(downloadTaskFile("id", "notes.txt")).rejects.toThrow(
      "Connection lost",
    );
    expect(click).not.toHaveBeenCalled();
  });
  it("preserves server permission errors before any progress or save", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json(
            { error: { code: "FORBIDDEN", message: "File unavailable" } },
            { status: 403 },
          ),
        ),
    );
    const progress = vi.fn();
    await expect(
      downloadTaskFile("id", "notes.txt", progress),
    ).rejects.toMatchObject({ status: 403, code: "FORBIDDEN" });
    expect(progress).not.toHaveBeenCalled();
    expect(click).not.toHaveBeenCalled();
  });
});
