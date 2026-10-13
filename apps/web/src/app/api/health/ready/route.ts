import { checkDatabase } from "@yuzu/database";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const requestId = crypto.randomUUID();
  try {
    await checkDatabase();
    return Response.json(
      { data: { status: "ready" }, requestId },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    console.error(JSON.stringify({ event: "readiness_failed", requestId }));
    return Response.json(
      {
        error: { code: "NOT_READY", message: "The application is not ready." },
        requestId,
      },
      {
        status: 503,
        headers: { "Cache-Control": "no-store", "Retry-After": "5" },
      },
    );
  }
}
