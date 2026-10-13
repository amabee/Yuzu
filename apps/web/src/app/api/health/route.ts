export async function GET() {
  return Response.json(
    { data: { status: "ok" }, requestId: crypto.randomUUID() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
