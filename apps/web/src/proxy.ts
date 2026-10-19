import { NextResponse, type NextRequest } from "next/server";
import { findApiEndpoint } from "@/lib/api-registry";
import { API_GATE_HEADER, bearerToken, gateSecret } from "@/server/api-gate";

/**
 * API tokens only reach the public endpoints in the registry. The route
 * handlers trust a token only when this gate header is present and signed.
 */
export function proxy(request: NextRequest) {
  const headers = new Headers(request.headers);
  headers.delete(API_GATE_HEADER);
  if (bearerToken(headers)) {
    const endpoint = findApiEndpoint(request.method, request.nextUrl.pathname);
    if (!endpoint)
      return NextResponse.json(
        {
          error: {
            code: "NOT_AVAILABLE_TO_TOKENS",
            message:
              "API tokens can't use this endpoint. See Settings → API for the ones they can.",
          },
        },
        { status: 403, headers: { "Cache-Control": "no-store" } },
      );
    headers.set(API_GATE_HEADER, `${endpoint.access}.${gateSecret()}`);
  }
  return NextResponse.next({ request: { headers } });
}

// Only requests with an Authorization header: running the proxy buffers the
// request body, which would break streamed browser uploads.
export const config = {
  matcher: [
    {
      source: "/api/:path*",
      has: [{ type: "header", key: "authorization" }],
    },
  ],
};
