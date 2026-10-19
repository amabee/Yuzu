import { openApiDocument } from "@/lib/openapi";
import { configuredOrigin } from "@/server/setup/security";

/** The public API's OpenAPI description, built from the endpoint registry. */
export function GET() {
  return Response.json(openApiDocument(`${configuredOrigin()}/api/v1`), {
    headers: { "Cache-Control": "no-store" },
  });
}
