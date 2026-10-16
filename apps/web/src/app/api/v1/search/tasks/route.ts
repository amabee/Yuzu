import { z } from "zod";
import { searchTasks } from "@/server/task-search-service";
import { SetupError } from "@/server/setup/security";

export async function GET(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    const data = await searchTasks(
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
              ? "Search with 2–200 characters and a valid cursor."
              : "Task search could not load. Try again.",
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
