import { taskAttachments, uploadAttachment } from "@/server/attachment-service";
import { attachmentError } from "@/server/attachment-response";
import { notifyBoardMutation } from "@/server/realtime";

export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    return Response.json(
      {
        data: await taskAttachments(
          new URL(request.url).searchParams.get("taskId") ?? "",
          request.headers,
        ),
        requestId: crypto.randomUUID(),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return attachmentError(error);
  }
}
export async function POST(request: Request) {
  try {
    const data = await uploadAttachment(
      new URL(request.url).searchParams.get("taskId") ?? "",
      request,
    );
    await notifyBoardMutation(data);
    return Response.json(
      { data, requestId: crypto.randomUUID() },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return attachmentError(error);
  }
}
