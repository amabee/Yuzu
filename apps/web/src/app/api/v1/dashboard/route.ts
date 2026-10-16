import { z } from "zod";
import { workspaceDashboard } from "@/server/dashboard-service";
import { SetupError } from "@/server/setup/security";

export async function GET(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    const data = await workspaceDashboard(
      request.headers,
      Object.fromEntries(new URL(request.url).searchParams),
    );
    return Response.json(
      { data, requestId },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const known = error instanceof SetupError,
      invalid = error instanceof z.ZodError;
    return Response.json(
      {
        error: {
          code: known
            ? error.code
            : invalid
              ? "INVALID_INPUT"
              : "DASHBOARD_FAILED",
          message: known
            ? error.message
            : invalid
              ? "Choose a valid workspace and page."
              : "The overview could not load. Try again.",
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
