import { mutateSavedView } from "@/server/saved-view-service";
import { z } from "zod";
import { notifyBoardMutation, notifyNavigationChange } from "@/server/realtime";
import { recordId } from "@/lib/board-contract";
import {
  boardState,
  boardCalendar,
  boardTimeline,
  taskComments,
  createComment,
  changeComment,
  commentHistory,
  createTask,
  manageBoard,
  mutateTask,
  reorderTask,
} from "@/server/board-service";
import { readSetupBody, SetupError } from "@/server/setup/security";
import { linkOptions, linkTargets } from "@/server/record-links-service";
async function handle(request: Request, action: string) {
  const requestId = crypto.randomUUID();
  try {
    let data;
    if (request.method === "GET" && action === "state")
      data = await boardState(
        recordId.parse(new URL(request.url).searchParams.get("boardId")),
        request.headers,
        new URL(request.url).searchParams.has("query")
          ? JSON.parse(new URL(request.url).searchParams.get("query")!)
          : {},
      );
    else if (request.method === "GET" && action === "timeline")
      data = await boardTimeline(
        recordId.parse(new URL(request.url).searchParams.get("boardId")),
        request.headers,
        JSON.parse(new URL(request.url).searchParams.get("query") ?? "{}"),
      );
    else if (request.method === "GET" && action === "calendar")
      data = await boardCalendar(
        recordId.parse(new URL(request.url).searchParams.get("boardId")),
        request.headers,
        JSON.parse(new URL(request.url).searchParams.get("query") ?? "{}"),
      );
    else if (request.method === "GET" && action === "link-options") {
      const params = new URL(request.url).searchParams;
      data = await linkOptions(
        { fieldId: params.get("fieldId"), q: params.get("q") ?? "" },
        request.headers,
      );
    } else if (request.method === "GET" && action === "link-targets")
      data = await linkTargets(
        new URL(request.url).searchParams.get("boardId") ?? "",
        request.headers,
      );
    else if (request.method === "GET" && action === "comments")
      data = await taskComments(
        recordId.parse(new URL(request.url).searchParams.get("taskId")),
        request.headers,
      );
    else if (request.method === "GET" && action === "comment-history")
      data = await commentHistory(
        recordId.parse(new URL(request.url).searchParams.get("commentId")),
        request.headers,
      );
    else if (request.method === "POST") {
      const body = await readSetupBody(request, 262_144);
      if (["save-view", "select-view", "remove-view"].includes(action))
        data = await mutateSavedView(action, body, request.headers);
      else if (action === "comment")
        data = await createComment(body, request.headers);
      else if (action === "change-comment")
        data = await changeComment(body, request.headers);
      else if (action === "create-task")
        data = await createTask(body, request.headers);
      else if (action === "reorder")
        data = await reorderTask(body, request.headers);
      else if (["update", "archive", "restore", "editor"].includes(action))
        data = await mutateTask(action, body, request.headers);
      else if (
        [
          "create-board",
          "group",
          "field",
          "manager",
          "configure-field",
          "remove-field",
          "rename-group",
          "record-settings",
          "remove-group",
        ].includes(action)
      )
        data = await manageBoard(action, body, request.headers);
      else throw new SetupError(404, "NOT_FOUND", "Board action not found.");
      await notifyBoardMutation(
        { ...(body as object), ...(data as object) },
        data,
      );
      // A new board appears in other people's sidebars.
      if (action === "create-board") {
        const created = data as { id?: unknown };
        if (typeof created?.id === "string")
          void notifyNavigationChange({ boardId: created.id });
      }
    } else throw new SetupError(404, "NOT_FOUND", "Board action not found.");
    return Response.json(
      { data, requestId },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const known = error instanceof SetupError;
    const invalid = error instanceof z.ZodError || error instanceof SyntaxError;
    return Response.json(
      {
        error: {
          code: known
            ? error.code
            : invalid
              ? "INVALID_INPUT"
              : "BOARD_REQUEST_FAILED",
          message: known
            ? error.message
            : invalid
              ? error instanceof z.ZodError
                ? (error.issues[0]?.message ?? "Check the task fields.")
                : "Invalid board query."
              : "This change could not finish. Refresh and try again.",
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
export async function GET(
  request: Request,
  context: { params: Promise<{ action: string }> },
) {
  return handle(request, (await context.params).action);
}
export async function POST(
  request: Request,
  context: { params: Promise<{ action: string }> },
) {
  return handle(request, (await context.params).action);
}
