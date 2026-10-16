import {
  changeTransfer,
  transferDetail,
  transferDownload,
} from "@/server/csv-transfer-service";
import { readSetupBody } from "@/server/setup/security";
import {
  transferError,
  transferResponse,
} from "@/server/csv-transfer-response";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const url = new URL(request.url);
    if (url.searchParams.has("download") || url.searchParams.has("report")) {
      const result = await transferDownload(
        id,
        request.headers,
        url.searchParams.has("report"),
      );
      return new Response(new Uint8Array(result.bytes), {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(result.filename)}`,
          "Content-Length": String(result.bytes.length),
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }
    return transferResponse(await transferDetail(id, request.headers));
  } catch (error) {
    return transferError(error);
  }
}
export async function POST(request: Request, context: Context) {
  try {
    return transferResponse(
      await changeTransfer(
        (await context.params).id,
        await readSetupBody(request, 3_100_000),
        request.headers,
      ),
    );
  } catch (error) {
    return transferError(error);
  }
}
