import { z } from "zod";
import { recordId } from "@/lib/board-contract";
import { readSetupBody, SetupError } from "@/server/setup/security";
import { notifyBoardMutation } from "@/server/realtime";
import {
  automationRuns,
  listAutomations,
  mutateAutomation,
} from "@/server/automation-service";

async function handle(request: Request, action: string) {
  const requestId = crypto.randomUUID();
  try {
    let data: unknown;
    const params = new URL(request.url).searchParams;
    if (request.method === "GET" && action === "list")
      data = await listAutomations(
        recordId.parse(params.get("boardId")),
        request.headers,
      );
    else if (request.method === "GET" && action === "runs")
      data = await automationRuns(
        recordId.parse(params.get("ruleId")),
        request.headers,
      );
    else if (
      request.method === "POST" &&
      ["save", "toggle", "remove"].includes(action)
    ) {
      const body = await readSetupBody(request);
      data = await mutateAutomation(
        `${action}-automation`,
        body,
        request.headers,
      );
      // Board managers see rule changes live.
      await notifyBoardMutation(data, data);
    } else
      throw new SetupError(404, "NOT_FOUND", "Automation action not found.");
    return Response.json(
      { data, requestId },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const invalid = error instanceof z.ZodError;
    const known = error instanceof SetupError;
    if (!known && !invalid) console.error("automation request failed", error);
    return Response.json(
      {
        error: {
          code: known
            ? error.code
            : invalid
              ? "INVALID_INPUT"
              : "AUTOMATION_REQUEST_FAILED",
          message: known
            ? error.message
            : invalid
              ? error.issues[0]?.message
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
export async function POST(
  request: Request,
  context: { params: Promise<{ action: string }> },
) {
  return handle(request, (await context.params).action);
}
