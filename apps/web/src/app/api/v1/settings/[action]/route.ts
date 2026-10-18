import { z } from "zod";
import { readSetupBody, SetupError } from "@/server/setup/security";
import {
  updateAutomationSettings,
  updateCalendarSettings,
} from "@/server/installation-settings-service";

export async function POST(
  request: Request,
  context: { params: Promise<{ action: string }> },
) {
  const requestId = crypto.randomUUID();
  try {
    const action = (await context.params).action;
    if (action !== "calendar" && action !== "automation")
      throw new SetupError(404, "NOT_FOUND", "Settings action not found.");
    const body = await readSetupBody(request);
    const data =
      action === "calendar"
        ? await updateCalendarSettings(body, request.headers)
        : await updateAutomationSettings(body, request.headers);
    return Response.json(
      { data, requestId },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const known = error instanceof SetupError;
    const invalid = error instanceof z.ZodError;
    if (!known && !invalid) console.error("settings request failed", error);
    return Response.json(
      {
        error: {
          code: known
            ? error.code
            : invalid
              ? "INVALID_INPUT"
              : "SETTINGS_FAILED",
          message: known
            ? error.message
            : invalid
              ? error.issues[0]?.message
              : "Settings could not be saved. Try again.",
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
