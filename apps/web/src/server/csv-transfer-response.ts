import { z } from "zod";
import { SetupError } from "./setup/security";
export function transferError(error: unknown) {
  const known = error instanceof SetupError;
  const invalid = error instanceof z.ZodError;
  if (!known && !invalid)
    console.error(
      JSON.stringify({
        event: "csv_transfer_failed",
        name: error instanceof Error ? error.name : "Unknown",
      }),
    );
  return Response.json(
    {
      error: {
        code: known
          ? error.code
          : invalid
            ? "INVALID_INPUT"
            : "TRANSFER_FAILED",
        message: known
          ? error.message
          : invalid
            ? error.issues[0]?.message
            : "The transfer could not finish. Try again shortly.",
      },
      requestId: crypto.randomUUID(),
    },
    {
      status: known ? error.status : invalid ? 422 : 500,
      headers: { "Cache-Control": "private, no-store" },
    },
  );
}
export function transferResponse(data: unknown) {
  return Response.json(
    { data, requestId: crypto.randomUUID() },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
