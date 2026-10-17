import { z } from "zod";
import { readSetupBody, SetupError } from "@/server/setup/security";
import {
  changeProjectMember,
  createProject,
  inviteToProject,
  listProjects,
  moveBoard,
  projectDirectory,
  recoverProject,
  reorderProjects,
  revokeProjectInvitation,
  setProjectArchived,
  updateProject,
} from "@/server/project-service";

async function handle(request: Request, action: string) {
  const requestId = crypto.randomUUID();
  try {
    let data: unknown;
    if (request.method === "GET" && action === "list")
      data = await listProjects(
        request.headers,
        Object.fromEntries(new URL(request.url).searchParams),
      );
    else if (request.method === "GET" && action === "directory")
      data = await projectDirectory(request.headers);
    else if (request.method === "POST") {
      const body = await readSetupBody(request);
      const headers = request.headers;
      if (action === "create") data = await createProject(body, headers);
      else if (action === "update") data = await updateProject(body, headers);
      else if (action === "reorder")
        data = await reorderProjects(body, headers);
      else if (action === "archive")
        data = await setProjectArchived(body, headers, true);
      else if (action === "restore")
        data = await setProjectArchived(body, headers, false);
      else if (action === "member")
        data = await changeProjectMember(body, headers);
      else if (action === "invite") data = await inviteToProject(body, headers);
      else if (action === "revoke-invite")
        data = await revokeProjectInvitation(body, headers);
      else if (action === "recover") data = await recoverProject(body, headers);
      else if (action === "move-board") data = await moveBoard(body, headers);
      else throw new SetupError(404, "NOT_FOUND", "Project action not found.");
    } else throw new SetupError(404, "NOT_FOUND", "Project action not found.");
    return Response.json(
      { data, requestId },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const invalid = error instanceof z.ZodError;
    const known = error instanceof SetupError;
    if (!known && !invalid) console.error("project request failed", error);
    return Response.json(
      {
        error: {
          code: known
            ? error.code
            : invalid
              ? "INVALID_INPUT"
              : "PROJECT_REQUEST_FAILED",
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
        headers: {
          "Cache-Control": "no-store",
          ...(known && error.status === 429 ? { "Retry-After": "60" } : {}),
        },
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
