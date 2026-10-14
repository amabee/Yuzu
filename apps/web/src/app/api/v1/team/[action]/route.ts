import { z } from "zod";
import { readSetupBody, SetupError } from "@/server/setup/security";
import {
  acceptInvitation,
  previewInvitation,
  removeMember,
  revokeInvitation,
  sendInvitation,
  teamState,
} from "@/server/team-service";

async function handle(request: Request, action: string) {
  const requestId = crypto.randomUUID();
  try {
    let data: unknown;
    if (request.method === "GET" && action === "state")
      data = await teamState(request.headers);
    else if (request.method === "POST") {
      const body = await readSetupBody(request);
      if (action === "invite")
        data = await sendInvitation(body, request.headers);
      else if (action === "revoke")
        data = await revokeInvitation(body, request.headers);
      else if (action === "remove")
        data = await removeMember(body, request.headers);
      else if (action === "preview")
        data = await previewInvitation(body, request.headers);
      else if (action === "accept")
        data = await acceptInvitation(body, request.headers);
      else throw new SetupError(404, "NOT_FOUND", "Team action not found.");
    } else throw new SetupError(404, "NOT_FOUND", "Team action not found.");
    return Response.json(
      { data, requestId },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const invalid = error instanceof z.ZodError;
    const known = error instanceof SetupError;
    return Response.json(
      {
        error: {
          code: known
            ? error.code
            : invalid
              ? "INVALID_INPUT"
              : "TEAM_REQUEST_FAILED",
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
