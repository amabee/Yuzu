import { z } from "zod";
import {
  approvalQueue,
  configureApprovals,
  decideApproval,
} from "@/server/approval-service";
import { readSetupBody, SetupError } from "@/server/setup/security";
import { notifyBoardMutation } from "@/server/realtime";
async function handle(request: Request, action: string) {
  const requestId = crypto.randomUUID();
  try {
    let data;
    if (request.method === "GET" && action === "queue") {
      const params = new URL(request.url).searchParams;
      data = await approvalQueue(
        request.headers,
        params.get("status") ?? "PENDING",
        params.get("cursor") ?? undefined,
        params.get("request") ?? undefined,
      );
    } else if (
      request.method === "POST" &&
      ["configure", "decide"].includes(action)
    ) {
      const body = await readSetupBody(request);
      data =
        action === "configure"
          ? await configureApprovals(body, request.headers)
          : await decideApproval(body, request.headers);
      await notifyBoardMutation(data);
    } else throw new SetupError(404, "NOT_FOUND", "Approval action not found.");
    return Response.json(
      { data, requestId },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const known = error instanceof SetupError;
    return Response.json(
      {
        error: {
          code: known
            ? error.code
            : error instanceof z.ZodError
              ? "INVALID_INPUT"
              : "APPROVAL_FAILED",
          message: known
            ? error.message
            : error instanceof z.ZodError
              ? (error.issues[0]?.message ?? "Check the request.")
              : "The approval could not finish. Try again.",
        },
        requestId,
      },
      {
        status: known ? error.status : error instanceof z.ZodError ? 422 : 500,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}
export async function GET(
  request: Request,
  { params }: { params: Promise<{ action: string }> },
) {
  return handle(request, (await params).action);
}
export async function POST(
  request: Request,
  { params }: { params: Promise<{ action: string }> },
) {
  return handle(request, (await params).action);
}
