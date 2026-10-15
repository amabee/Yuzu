import { open } from "node:fs/promises";
import { Readable } from "node:stream";
import {
  downloadAttachment,
  removeAttachment,
} from "@/server/attachment-service";
import { attachmentPath } from "@/server/attachment-storage";
import { attachmentError } from "@/server/attachment-response";
import { notifyBoardMutation } from "@/server/realtime";
import { readSetupBody, SetupError } from "@/server/setup/security";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  try {
    const file = await downloadAttachment(
      (await context.params).id,
      request.headers,
    );
    let handle;
    try {
      handle = await open(attachmentPath(file.storageKey), "r");
    } catch {
      throw new SetupError(
        404,
        "FILE_UNAVAILABLE",
        "The stored file is unavailable. Contact your administrator.",
      );
    }
    const fallback = file.fileName.replace(/[^a-zA-Z0-9._ -]/g, "_");
    const encoded = encodeURIComponent(file.fileName).replace(
      /['()*]/g,
      (c) => `%${c.charCodeAt(0).toString(16)}`,
    );
    return new Response(
      Readable.toWeb(handle.createReadStream()) as ReadableStream<Uint8Array>,
      {
        headers: {
          "Content-Type": file.mimeType,
          "Content-Length": String(file.sizeBytes),
          "Content-Disposition": `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`,
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
          "Content-Security-Policy": "default-src 'none'; sandbox",
          "Cross-Origin-Resource-Policy": "same-origin",
        },
      },
    );
  } catch (error) {
    return attachmentError(error);
  }
}
export async function DELETE(request: Request, context: Context) {
  try {
    await readSetupBody(request);
    const data = await removeAttachment(
      (await context.params).id,
      request.headers,
    );
    await notifyBoardMutation(data);
    return Response.json(
      { data, requestId: crypto.randomUUID() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return attachmentError(error);
  }
}
