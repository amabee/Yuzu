import { z } from "zod";
import {
  notificationInbox,
  changeNotification,
} from "@/server/notification-service";
import { readSetupBody, SetupError } from "@/server/setup/security";
import { notifyBoardMutation } from "@/server/realtime";
async function handle(request: Request, action: string) {
  const requestId = crypto.randomUUID();
  try {
    let data;
    if (request.method === "GET" && action === "inbox") {
      const params = new URL(request.url).searchParams;
      data = await notificationInbox(request.headers, {
        filter: params.get("filter") ?? "ALL",
        cursor: params.get("cursor") ?? undefined,
      });
    } else if (request.method === "POST" && action === "change") {
      data = await changeNotification(
        request.headers,
        await readSetupBody(request),
      );
      await notifyBoardMutation({ ...data, notificationOnly: true });
    } else
      throw new SetupError(404, "NOT_FOUND", "Notification action not found.");
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
              : "NOTIFICATION_FAILED",
          message: known
            ? error.message
            : error instanceof z.ZodError
              ? "Check the notification request."
              : "The inbox could not update. Try again.",
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
