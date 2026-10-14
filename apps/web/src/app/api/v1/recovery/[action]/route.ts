import { z } from "zod";
import { readSetupBody, SetupError } from "@/server/setup/security";
import { finishRecovery, requestRecovery } from "@/server/recovery-service";

export const maxDuration = 60;
export async function POST(
  request: Request,
  context: { params: Promise<{ action: string }> },
) {
  const requestId = crypto.randomUUID();
  try {
    const input = await readSetupBody(request);
    const { action } = await context.params;
    const data =
      action === "request"
        ? await requestRecovery(input)
        : action === "reset"
          ? await finishRecovery(input)
          : null;
    if (!data)
      throw new SetupError(404, "NOT_FOUND", "Recovery action not found.");
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
              : "RECOVERY_FAILED",
          message: known
            ? error.message
            : invalid
              ? error.issues[0]?.message
              : "Recovery could not finish. Try again later.",
        },
        requestId,
      },
      {
        status: known ? error.status : invalid ? 422 : 500,
        headers: {
          "Cache-Control": "no-store",
          ...(known && error.status === 429
            ? { "Retry-After": error.code === "WAIT_TO_RESEND" ? "60" : "600" }
            : {}),
        },
      },
    );
  }
}
