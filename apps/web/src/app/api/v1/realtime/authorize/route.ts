import { z } from "zod";
import { recordId } from "@/lib/board-contract";
import { authorizeBoardRealtime } from "@/server/realtime";
import { readSetupBody, SetupError } from "@/server/setup/security";
export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    const { boardId } = z
      .object({ boardId: recordId.optional() })
      .strict()
      .parse(await readSetupBody(request));
    const data = await authorizeBoardRealtime(boardId, request.headers);
    return Response.json(
      { data, requestId },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const known = error instanceof SetupError;
    return Response.json(
      {
        error: {
          code: known ? error.code : "REALTIME_UNAVAILABLE",
          message: known
            ? error.message
            : "Live updates are unavailable. Periodic sync will continue.",
        },
        requestId,
      },
      {
        status: known ? error.status : error instanceof z.ZodError ? 422 : 503,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}
