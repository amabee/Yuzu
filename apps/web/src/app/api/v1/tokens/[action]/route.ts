import { z } from "zod";
import { readSetupBody, SetupError } from "@/server/setup/security";
import {
  createToken,
  listTokens,
  revokeToken,
} from "@/server/api-token-service";

async function handle(request: Request, action: string) {
  const requestId = crypto.randomUUID();
  try {
    let data: unknown;
    if (request.method === "GET" && action === "list")
      data = await listTokens(
        request.headers,
        new URL(request.url).searchParams.get("all") === "1",
      );
    else if (request.method === "POST" && action === "create")
      data = await createToken(await readSetupBody(request), request.headers);
    else if (request.method === "POST" && action === "revoke")
      data = await revokeToken(await readSetupBody(request), request.headers);
    else throw new SetupError(404, "NOT_FOUND", "Token action not found.");
    return Response.json(
      { data, requestId },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const invalid = error instanceof z.ZodError;
    const known = error instanceof SetupError;
    if (!known && !invalid) console.error(error);
    return Response.json(
      {
        error: {
          code: known
            ? error.code
            : invalid
              ? "INVALID_INPUT"
              : "TOKEN_REQUEST_FAILED",
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
type Context = { params: Promise<{ action: string }> };
export async function GET(request: Request, context: Context) {
  return handle(request, (await context.params).action);
}
export async function POST(request: Request, context: Context) {
  return handle(request, (await context.params).action);
}
