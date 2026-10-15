import { z } from "zod";
import {
  claimOwner,
  correctOwnerEmail,
  completeSetup,
  saveInstallation,
  sendVerification,
  setupStatus,
  verifyReceipt,
} from "@/server/setup/service";
import { readSetupBody, SetupError } from "@/server/setup/security";

export const runtime = "nodejs";
const response = (data: unknown, requestId: string, cookies: string[] = []) => {
  const headers = new Headers({ "Cache-Control": "no-store" });
  cookies.forEach((cookie) => headers.append("Set-Cookie", cookie));
  return Response.json({ data, requestId }, { headers });
};
async function handle(request: Request, action: string) {
  const requestId = crypto.randomUUID();
  try {
    if (request.method === "GET" && action === "status")
      return response(await setupStatus(request.headers), requestId);
    const input = await readSetupBody(request);
    let cookies: string[] = [];
    if (action === "owner") cookies = await claimOwner(input);
    else if (action === "owner-email")
      await correctOwnerEmail(input, request.headers);
    else if (action === "installation")
      await saveInstallation(input, request.headers);
    else if (action === "email") await sendVerification(input, request.headers);
    else if (action === "verify") await verifyReceipt(input, request.headers);
    else if (action === "complete") await completeSetup(input, request.headers);
    else throw new SetupError(404, "NOT_FOUND", "Setup action not found.");
    return response({ saved: true }, requestId, cookies);
  } catch (error) {
    if (error instanceof z.ZodError)
      return Response.json(
        {
          error: {
            code: "INVALID_INPUT",
            message: error.issues[0]?.message ?? "Check the supplied values.",
          },
          requestId,
        },
        { status: 422, headers: { "Cache-Control": "no-store" } },
      );
    if (error instanceof SetupError)
      return Response.json(
        { error: { code: error.code, message: error.message }, requestId },
        {
          status: error.status,
          headers: {
            "Cache-Control": "no-store",
            ...(error.status === 429
              ? {
                  "Retry-After":
                    error.code === "WAIT_BEFORE_RESENDING" ? "60" : "600",
                }
              : {}),
          },
        },
      );
    console.error(JSON.stringify({ event: "setup_request_failed", requestId }));
    return Response.json(
      {
        error: {
          code: "SETUP_FAILED",
          message: "Setup could not finish this step. Refresh and try again.",
        },
        requestId,
      },
      { status: 500, headers: { "Cache-Control": "no-store" } },
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
