import { z } from "zod";
import { crmDirectory, crmMatches, crmRecord } from "@/server/crm-service";
import { SetupError } from "@/server/setup/security";

/** Reads for the CRM module. Records are created and changed through the
 *  shared record endpoints under /api/v1/boards. */
async function handle(request: Request, action: string) {
  const requestId = crypto.randomUUID();
  try {
    const params = new URL(request.url).searchParams;
    const query = () => JSON.parse(params.get("query") ?? "{}");
    let data;
    if (action === "directory")
      data = await crmDirectory(
        query(),
        params.get("workspaceId") ?? "",
        request.headers,
      );
    else if (action === "record")
      data = await crmRecord(
        { recordId: params.get("recordId") },
        request.headers,
      );
    else if (action === "matches")
      data = await crmMatches(
        query(),
        params.get("workspaceId") ?? "",
        request.headers,
      );
    else throw new SetupError(404, "NOT_FOUND", "CRM action not found.");
    return Response.json(
      { data, requestId },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const known = error instanceof SetupError;
    const invalid = error instanceof z.ZodError || error instanceof SyntaxError;
    return Response.json(
      {
        error: {
          code: known ? error.code : invalid ? "INVALID_INPUT" : "CRM_REQUEST_FAILED",
          message: known
            ? error.message
            : invalid
              ? error instanceof z.ZodError
                ? (error.issues[0]?.message ?? "Check the request.")
                : "Invalid CRM query."
              : "This request could not finish. Refresh and try again.",
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
export async function GET(
  request: Request,
  context: { params: Promise<{ action: string }> },
) {
  return handle(request, (await context.params).action);
}
