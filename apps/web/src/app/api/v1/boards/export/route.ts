import { z } from "zod";
import { exportBoardCsv } from "@/server/csv-export-service";
import { readSetupBody, SetupError } from "@/server/setup/security";

export const runtime = "nodejs";
export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    const data = await exportBoardCsv(
      await readSetupBody(request),
      request.headers,
      request.signal,
    );
    const encoded = encodeURIComponent(data.filename).replace(
      /['()*]/gu,
      (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
    );
    return new Response(data.csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="yuzu-tasks.csv"; filename*=UTF-8''${encoded}`,
        "Content-Length": String(Buffer.byteLength(data.csv)),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "X-Request-Id": requestId,
        "X-Yuzu-Export-Rows": String(data.rowCount),
      },
    });
  } catch (error) {
    const known = error instanceof SetupError;
    const invalid = error instanceof z.ZodError;
    if (!known && !invalid)
      console.error(
        JSON.stringify({ event: "board_export_failed", requestId }),
      );
    return Response.json(
      {
        error: {
          code: known
            ? error.code
            : invalid
              ? "INVALID_INPUT"
              : "EXPORT_FAILED",
          message: known
            ? error.message
            : invalid
              ? error.issues[0]?.message
              : "The export could not finish. Please try again.",
        },
        requestId,
      },
      {
        status: known ? error.status : invalid ? 422 : 500,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}
