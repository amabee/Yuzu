import { z } from "zod";
import { searchNavigation } from "@/server/navigation-search-service";
import { SetupError } from "@/server/setup/security";
export async function GET(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    const data = await searchNavigation(
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
              : "SEARCH_FAILED",
          message: known
            ? error.message
            : invalid
              ? "Use a valid resource, archive filter, search and cursor."
              : "Navigation search could not load. Try again.",
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
