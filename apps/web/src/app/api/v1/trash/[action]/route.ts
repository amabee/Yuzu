import { z } from "zod";
import { readSetupBody, SetupError } from "@/server/setup/security";
import {
  deleteBoard,
  deleteProject,
  deleteRecord,
  eraseTrash,
  restoreBoard,
  restoreProject,
  restoreRecord,
  setTrashRetention,
  trashState,
} from "@/server/trash-service";
import { notifyBoardMutation, notifyNavigationChange } from "@/server/realtime";

const notFound = () =>
  new SetupError(404, "NOT_FOUND", "Trash action not found.");

async function handle(request: Request, action: string) {
  const requestId = crypto.randomUUID();
  try {
    let data: unknown;
    const { headers } = request;
    if (request.method === "GET") {
      if (action !== "list") throw notFound();
      data = await trashState(
        { boardId: new URL(request.url).searchParams.get("boardId") },
        headers,
      );
    } else {
      const body = await readSetupBody(request);
      if (action === "delete-record") {
        const result = await deleteRecord(body, headers);
        await notifyBoardMutation(result, result);
        data = result;
      } else if (action === "restore-record") {
        const result = await restoreRecord(body, headers);
        await notifyBoardMutation(result, result);
        void notifyNavigationChange({ boardId: result.boardId });
        data = result;
      } else if (action === "delete-board" || action === "restore-board") {
        const result =
          action === "delete-board"
            ? await deleteBoard(body, headers)
            : await restoreBoard(body, headers);
        await notifyBoardMutation({ boardId: result.boardId });
        void notifyNavigationChange({ workspaceId: result.workspaceId });
        data = result;
      } else if (action === "delete-project" || action === "restore-project") {
        const result =
          action === "delete-project"
            ? await deleteProject(body, headers)
            : await restoreProject(body, headers);
        void notifyNavigationChange({ workspaceId: result.workspaceId });
        data = result;
      } else if (action === "erase") data = await eraseTrash(body, headers);
      else if (action === "retention")
        data = await setTrashRetention(body, headers);
      else throw notFound();
    }
    return Response.json(
      { data, requestId },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const invalid = error instanceof z.ZodError;
    const known = error instanceof SetupError;
    if (!known && !invalid) console.error(error);
    return Response.json(
      {
        error: {
          code: known
            ? error.code
            : invalid
              ? "INVALID_INPUT"
              : "TRASH_REQUEST_FAILED",
          message: known
            ? error.message
            : invalid
              ? error.issues[0]?.message
              : "This request could not finish. Refresh and try again.",
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
type Context = { params: Promise<{ action: string }> };
export async function GET(request: Request, context: Context) {
  return handle(request, (await context.params).action);
}
export async function POST(request: Request, context: Context) {
  return handle(request, (await context.params).action);
}
