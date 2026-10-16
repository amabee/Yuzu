import { z } from "zod";
import { previewCsvImport, importCsvRow } from "@/server/csv-import-service";
import { readSetupBody, SetupError } from "@/server/setup/security";

export const runtime = "nodejs";
export async function POST(
  request: Request,
  context: { params: Promise<{ action: string }> },
) {
  const requestId = crypto.randomUUID();
  try {
    const { action } = await context.params;
    if (action !== "preview" && action !== "row")
      throw new SetupError(404, "NOT_FOUND", "Import action not found.");
    const body = await readSetupBody(
      request,
      action === "preview" ? 6_100_000 : 2_100_000,
    );
    const data = await (action === "preview"
      ? previewCsvImport(body, request.headers)
      : importCsvRow(body, request.headers));
    return Response.json(
      { data, requestId },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    const known = error instanceof SetupError,
      invalid = error instanceof z.ZodError;
    if (!known && !invalid)
      console.error(
        JSON.stringify({ event: "board_import_failed", requestId }),
      );
    return Response.json(
      {
        error: {
          code: known
            ? error.code
            : invalid
              ? "INVALID_INPUT"
              : "IMPORT_FAILED",
          message: known
            ? error.message
            : invalid
              ? error.issues[0]?.message
              : "This row could not be imported. Retry it from the results.",
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
