import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { crc32, deflateRawSync } from "node:zlib";
import { attachmentPath, receiveAttachment } from "./attachment-storage";
import { validateAttachment } from "./attachment-validation";

let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "yuzu-upload-test-"));
  vi.stubEnv("YUZU_UPLOAD_DIR", directory);
});
afterEach(async () => {
  if (!directory.startsWith(join(tmpdir(), "yuzu-upload-test-")))
    throw new Error("Invalid test cleanup directory.");
  await rm(directory, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

describe("private attachment storage", () => {
  it("accepts exactly 50 MB and rejects one extra streamed byte", async () => {
    const chunk = new Uint8Array(65536).fill(65);
    const request = (bytes: number) =>
      new Request("http://localhost/upload", {
        method: "POST",
        duplex: "half",
        body: new ReadableStream({
          pull(controller) {
            if (!bytes) {
              controller.close();
              return;
            }
            const count = Math.min(bytes, chunk.length);
            controller.enqueue(chunk.subarray(0, count));
            bytes -= count;
          },
        }),
      } as RequestInit);
    const file = await receiveAttachment(request(50_000_000), 50_000_000);
    expect(file.sizeBytes).toBe(50_000_000);
    await expect(
      validateAttachment(
        attachmentPath(file.storageKey),
        "large.txt",
        "text/plain",
      ),
    ).resolves.toMatchObject({ mimeType: "text/plain" });
    await expect(
      receiveAttachment(request(50_000_001), 50_000_000),
    ).rejects.toMatchObject({ status: 413 });
    expect(await readdir(directory)).toEqual([`${file.storageKey}.bin`]);
  }, 20_000);
  it("streams bytes, hashes them and uses a UUIDv7 storage key", async () => {
    const request = new Request("http://localhost/upload", {
      method: "POST",
      body: "Team notes",
    });
    const file = await receiveAttachment(request, 50_000_000);
    expect(file.storageKey).toMatch(/^[0-9a-f-]{14}7/);
    expect(file.sizeBytes).toBe(10);
    expect(file.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(await readFile(attachmentPath(file.storageKey), "utf8")).toBe(
      "Team notes",
    );
  });
  it("bounds actual streamed bytes without trusting Content-Length and removes partial data", async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("too much content"));
        controller.close();
      },
    });
    const request = new Request("http://localhost/upload", {
      method: "POST",
      body: stream,
      duplex: "half",
    } as RequestInit);
    await expect(receiveAttachment(request, 5)).rejects.toMatchObject({
      status: 413,
    });
    expect(await readdir(directory)).toEqual([]);
  });
  it("rejects incomplete and empty transfers and never accepts path traversal keys", async () => {
    await expect(
      receiveAttachment(
        new Request("http://localhost/upload", {
          method: "POST",
          body: "short",
          headers: { "Content-Length": "12" },
        }),
        20,
      ),
    ).rejects.toMatchObject({ code: "INCOMPLETE_UPLOAD" });
    await expect(
      receiveAttachment(
        new Request("http://localhost/upload", { method: "POST", body: "" }),
        20,
      ),
    ).rejects.toMatchObject({ code: "EMPTY_FILE" });
    expect(await readdir(directory)).toEqual([]);
    expect(() => attachmentPath("../../secret")).toThrow("storage key");
  });
});

describe("attachment content validation", () => {
  function zip(entries: Record<string, string>) {
    const local: Buffer[] = [];
    const central: Buffer[] = [];
    let offset = 0;
    for (const [name, text] of Object.entries(entries)) {
      const filename = Buffer.from(name);
      const content = Buffer.from(text);
      const compressed = deflateRawSync(content);
      const header = Buffer.alloc(30);
      header.writeUInt32LE(0x04034b50, 0);
      header.writeUInt16LE(20, 4);
      header.writeUInt16LE(8, 8);
      header.writeUInt32LE(crc32(content), 14);
      header.writeUInt32LE(compressed.length, 18);
      header.writeUInt32LE(content.length, 22);
      header.writeUInt16LE(filename.length, 26);
      local.push(header, filename, compressed);
      const directory = Buffer.alloc(46);
      directory.writeUInt32LE(0x02014b50, 0);
      directory.writeUInt16LE(20, 4);
      directory.writeUInt16LE(20, 6);
      directory.writeUInt16LE(8, 10);
      directory.writeUInt32LE(crc32(content), 16);
      directory.writeUInt32LE(compressed.length, 20);
      directory.writeUInt32LE(content.length, 24);
      directory.writeUInt16LE(filename.length, 28);
      directory.writeUInt32LE(offset, 42);
      central.push(directory, filename);
      offset += header.length + filename.length + compressed.length;
    }
    const directory = Buffer.concat(central);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(central.length / 2, 8);
    end.writeUInt16LE(central.length / 2, 10);
    end.writeUInt32LE(directory.length, 12);
    end.writeUInt32LE(offset, 16);
    return Buffer.concat([...local, directory, end]);
  }
  async function check(
    name: string,
    content: string | Buffer,
    mime = "application/octet-stream",
  ) {
    const path = join(directory, "fixture");
    await writeFile(path, content);
    return validateAttachment(path, name, mime);
  }
  it("allows UTF-8 text/CSV and detects binary image/PDF signatures", async () => {
    expect(
      (await check("notes.txt", "Yuzu team notes 🍋", "text/plain")).mimeType,
    ).toBe("text/plain");
    expect(
      (await check("tasks.csv", "name,status\nTask,Done", "text/csv")).mimeType,
    ).toBe("text/csv");
    expect(
      (
        await check(
          "document.pdf",
          "%PDF-1.4\nPDF test bytes",
          "application/pdf",
        )
      ).mimeType,
    ).toBe("application/pdf");
    expect(
      (
        await check(
          "tiny.png",
          Buffer.from(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aM1sAAAAASUVORK5CYII=",
            "base64",
          ),
          "image/png",
        )
      ).mimeType,
    ).toBe("image/png");
  });
  it.each([
    ["page.html", "<html>hidden</html>"],
    ["icon.svg", "<svg></svg>"],
    ["fake.png", "not an image"],
    ["fake.txt", "<svg></svg>"],
    ["script.txt", "#!/bin/sh\necho nope"],
    ["program.txt", Buffer.from([77, 90, 0, 1, 2])],
    ["bad.txt", Buffer.from([0xff, 0xfe])],
    ["../notes.txt", "notes"],
    ["archive.zip", "PK archive"],
  ])("rejects prohibited or mismatched content: %s", async (name, content) => {
    await expect(check(name, content)).rejects.toThrow();
  });
  it("rejects an allowed extension with a conflicting declared MIME type", async () => {
    await expect(
      check("notes.txt", "notes", "application/pdf"),
    ).rejects.toMatchObject({ status: 415 });
  });
  it.each([
    [
      "docx",
      "word/document.xml",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ],
    [
      "xlsx",
      "xl/workbook.xml",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ],
    [
      "pptx",
      "ppt/presentation.xml",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ],
  ])(
    "recognizes %s document packages while rejecting ordinary ZIP archives",
    async (extension, part, mime) => {
      const content = zip({
        "[Content_Types].xml": `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/${part}" ContentType="${mime}.main+xml"/></Types>`,
        [part]: "<document/>",
      });
      expect(
        (await check(`document.${extension}`, content, mime)).mimeType,
      ).toBe(mime);
      await expect(
        check(`archive.${extension}`, zip({ "notes.txt": "notes" }), mime),
      ).rejects.toMatchObject({ status: 415 });
    },
  );
});
