import { z } from "zod";
import { crmDirectory, crmMatches, crmRecord } from "@/server/crm-service";
import {
  crmLinks,
  linkCompany,
  removeLink,
  setPrimary,
  updateLink,
} from "@/server/crm-links-service";
import { notifyBoardMutation } from "@/server/realtime";
import { readSetupBody, SetupError } from "@/server/setup/security";
import type { LinkResult } from "@/lib/crm-contract";
import {
  changeStages,
  createPipeline,
  listPipelines,
  pipelineSummary,
} from "@/server/pipeline-service";
import {
  customerDeals,
  dealLanes,
  dealList,
  dealRecord,
} from "@/server/deals-service";

const linkCommand = (action: string) =>
  action === "link"
    ? linkCompany
    : action === "update-link"
      ? updateLink
      : action === "remove-link"
        ? removeLink
        : action === "primary"
          ? setPrimary
          : null;

/** The CRM module's reads and its Contact–Company link commands. Records
 *  themselves are created and changed through /api/v1/boards. */
async function handle(request: Request, action: string) {
  const requestId = crypto.randomUUID();
  try {
    const params = new URL(request.url).searchParams;
    const query = () => JSON.parse(params.get("query") ?? "{}");
    let data;
    if (request.method === "POST" && action === "pipeline") {
      data = await createPipeline(
        await readSetupBody(request, 16_384),
        request.headers,
      );
      // A new pipeline appears for everyone in the workspace.
      await notifyBoardMutation({ boardId: data.boardId }, data);
    } else if (request.method === "POST" && action === "stages") {
      data = await changeStages(
        await readSetupBody(request, 16_384),
        request.headers,
      );
      await notifyBoardMutation({ boardId: data.boardId }, data);
    } else if (request.method === "POST") {
      const command = linkCommand(action);
      if (!command)
        throw new SetupError(404, "NOT_FOUND", "CRM action not found.");
      const result: LinkResult = await command(
        await readSetupBody(request, 16_384),
        request.headers,
      );
      // Both records' boards refresh: the contact's and the company's.
      await Promise.all([
        notifyBoardMutation({ boardId: result.contactBoardId }, result),
        notifyBoardMutation({ boardId: result.companyBoardId }, result),
      ]);
      data = result;
    } else if (action === "links")
      data = await crmLinks(
        {
          recordId: params.get("recordId"),
          ...(params.get("page") ? { page: Number(params.get("page")) } : {}),
        },
        request.headers,
      );
    else if (action === "pipelines")
      data = await listPipelines(
        params.get("workspaceId") ?? "",
        request.headers,
      );
    else if (action === "pipeline")
      data = await pipelineSummary(
        params.get("boardId") ?? "",
        request.headers,
      );
    else if (action === "deal-lanes")
      data = await dealLanes(query(), request.headers);
    else if (action === "deals")
      data = await dealList(query(), request.headers);
    else if (action === "deal")
      data = await dealRecord(
        { recordId: params.get("recordId") },
        request.headers,
      );
    else if (action === "customer-deals")
      data = await customerDeals(
        { recordId: params.get("recordId") },
        request.headers,
      );
    else if (action === "directory")
      data = await crmDirectory(
        query(),
        params.get("workspaceId") ?? "",
        request.headers,
      );
    else if (action === "record")
      data = await crmRecord(
        { recordId: params.get("recordId") },
        request.headers,
      );
    else if (action === "matches")
      data = await crmMatches(
        query(),
        params.get("workspaceId") ?? "",
        request.headers,
      );
    else throw new SetupError(404, "NOT_FOUND", "CRM action not found.");
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
              : "CRM_REQUEST_FAILED",
          ...(known && "details" in error ? { details: error.details } : {}),
          message: known
            ? error.message
            : invalid
              ? error instanceof z.ZodError
                ? (error.issues[0]?.message ?? "Check the request.")
                : "Invalid CRM query."
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
export async function POST(
  request: Request,
  context: { params: Promise<{ action: string }> },
) {
  return handle(request, (await context.params).action);
}
export async function GET(
  request: Request,
  context: { params: Promise<{ action: string }> },
) {
  return handle(request, (await context.params).action);
}
