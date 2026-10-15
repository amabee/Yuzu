import { getDatabase } from "@yuzu/database";

export const dynamic = "force-dynamic";
export async function GET() {
  const requestId = crypto.randomUUID();
  try {
    const settings = await getDatabase().installationSettings.findUnique({
      where: { id: "installation" },
      select: { maintenanceMode: true },
    });
    return Response.json(
      { data: { maintenance: settings?.maintenanceMode ?? false }, requestId },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      {
        error: { code: "NOT_READY", message: "Service status is unavailable." },
        requestId,
      },
      {
        status: 503,
        headers: { "Cache-Control": "no-store", "Retry-After": "5" },
      },
    );
  }
}
