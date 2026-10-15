import { z } from "zod";
import { SetupError } from "./setup/security";

export function attachmentError(error: unknown) {
  const known = error instanceof SetupError;
  const invalid = error instanceof z.ZodError;
  if (!known && !invalid)
    console.error(JSON.stringify({ event: "attachment_request_failed" }));
  return Response.json(
    {
      error: {
        code: known
          ? error.code
          : invalid
            ? "INVALID_INPUT"
            : "FILE_REQUEST_FAILED",
        message: known
          ? error.message
          : invalid
            ? error.issues[0]?.message
            : "The file request could not finish. Please try again.",
      },
      requestId: crypto.randomUUID(),
    },
    {
      status: known ? error.status : invalid ? 422 : 500,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
