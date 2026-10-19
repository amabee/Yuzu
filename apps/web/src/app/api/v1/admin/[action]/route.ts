import { z } from "zod";
import { readSetupBody, SetupError } from "@/server/setup/security";
import {
  archiveWorkspace,
  auditLog,
  changeRole,
  deactivatePerson,
  peopleState,
  reactivatePerson,
  renameWorkspace,
  transferOwnership,
  workspacesState,
} from "@/server/admin-service";

const notFound = () =>
  new SetupError(404, "NOT_FOUND", "Admin action not found.");

async function handle(request: Request, action: string) {
  const requestId = crypto.randomUUID();
  try {
    let data: unknown;
    const { headers } = request;
    if (request.method === "GET") {
      if (action === "people") data = await peopleState(headers);
      else if (action === "workspaces") data = await workspacesState(headers);
      else if (action === "audit")
        data = await auditLog(
          Object.fromEntries(new URL(request.url).searchParams),
          headers,
        );
      else throw notFound();
    } else {
      const body = await readSetupBody(request);
      if (action === "role") data = await changeRole(body, headers);
      else if (action === "deactivate")
        data = await deactivatePerson(body, headers);
      else if (action === "reactivate")
        data = await reactivatePerson(body, headers);
      else if (action === "transfer")
        data = await transferOwnership(body, headers);
      else if (action === "rename-workspace")
        data = await renameWorkspace(body, headers);
      else if (action === "archive-workspace")
        data = await archiveWorkspace(body, headers, true);
      else if (action === "restore-workspace")
        data = await archiveWorkspace(body, headers, false);
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
              : "ADMIN_REQUEST_FAILED",
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
          ...(known && error.status === 429 ? { "Retry-After": "600" } : {}),
        },
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
