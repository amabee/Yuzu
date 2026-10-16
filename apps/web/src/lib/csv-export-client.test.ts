import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { downloadBoardCsv } from "./csv-export-client";
import { MAX_CSV_BYTES } from "./csv-export";

const click = vi.fn();
let saved: Blob | undefined;
beforeEach(() => {
  vi.useFakeTimers();
  click.mockClear();
  saved = undefined;
  vi.stubGlobal("document", {
    createElement: () => ({ click, href: "", download: "" }),
  });
  vi.stubGlobal("window", { setTimeout, dispatchEvent: vi.fn() });
  vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
    saved = blob as Blob;
    return "blob:csv";
  });
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
const input = {
  boardId: "01900000-0000-7000-8000-000000000001",
  scope: "BOARD" as const,
  includeArchived: false,
};

describe("CSV download handoff", () => {
  it("posts only the selection and downloads the complete UTF-8 response with actual progress", async () => {
    const bytes = new TextEncoder().encode('\ufeff"Task"\r\n"柚子"\r\n');
    const fetch = vi.fn().mockResolvedValue(
      new Response(bytes, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Length": String(bytes.byteLength),
          "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent("柚子.csv")}`,
        },
      }),
    );
    vi.stubGlobal("fetch", fetch);
    const progress = vi.fn();
    expect(await downloadBoardCsv(input, progress)).toEqual({
      filename: "柚子.csv",
    });
    expect(JSON.parse(fetch.mock.calls[0]![1].body)).toEqual(input);
    expect(progress).toHaveBeenLastCalledWith(
      bytes.byteLength,
      bytes.byteLength,
    );
    expect(new Uint8Array(await saved!.arrayBuffer())).toEqual(bytes);
    expect(click).toHaveBeenCalledOnce();
  });
  it("does not hand error or unexpected JSON responses to the browser as CSV", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json(
            { error: { code: "NOT_FOUND", message: "No access" } },
            { status: 404 },
          ),
        ),
    );
    await expect(downloadBoardCsv(input)).rejects.toMatchObject({
      status: 404,
      code: "NOT_FOUND",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ data: [] })),
    );
    await expect(downloadBoardCsv(input)).rejects.toThrow("unexpected export");
    expect(click).not.toHaveBeenCalled();
  });
  it("rejects oversized responses before a download is created", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("oversized", {
          headers: {
            "Content-Type": "text/csv",
            "Content-Length": String(MAX_CSV_BYTES + 1),
          },
        }),
      ),
    );
    await expect(downloadBoardCsv(input)).rejects.toThrow("too large");
    expect(click).not.toHaveBeenCalled();
  });
});
