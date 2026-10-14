import { z } from "zod";
import {
  appearanceState,
  publishedAppearance,
  writeAppearance,
} from "@/server/appearance-service";
import { readSetupBody, SetupError } from "@/server/setup/security";

async function handle(request: Request, action: string) {
  const requestId = crypto.randomUUID();
  try {
    let data;
    if (request.method === "GET" && action === "published")
      data = await publishedAppearance();
    else if (request.method === "GET" && action === "state")
      data = await appearanceState(request.headers);
    else if (request.method === "POST")
      data = await writeAppearance(
        action,
        await readSetupBody(request),
        request.headers,
      );
    else throw new SetupError(404, "NOT_FOUND", "Appearance action not found.");
    return Response.json(
      { data, requestId },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const known = error instanceof SetupError;
    const invalid = error instanceof z.ZodError;
    return Response.json(
      {
        error: {
          code: known
            ? error.code
            : invalid
              ? "INVALID_INPUT"
              : "APPEARANCE_FAILED",
          message: known
            ? error.message
            : invalid
              ? "Use a valid Yuzu theme with supported colors and fonts."
              : "Appearance could not be saved. Try again.",
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
