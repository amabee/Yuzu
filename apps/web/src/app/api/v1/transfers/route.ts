import {
  transferError,
  transferResponse,
} from "@/server/csv-transfer-response";
import { createTransfer, listTransfers } from "@/server/csv-transfer-service";
import { readSetupBody } from "@/server/setup/security";

export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    return transferResponse(await listTransfers(request.headers));
  } catch (error) {
    return transferError(error);
  }
}
export async function POST(request: Request) {
  try {
    return transferResponse(
      await createTransfer(
        await readSetupBody(request, 32_000),
        request.headers,
      ),
    );
  } catch (error) {
    return transferError(error);
  }
}
