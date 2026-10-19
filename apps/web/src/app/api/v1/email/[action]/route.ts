import { z } from "zod";
import { readSetupBody, SetupError } from "@/server/setup/security";
import {
  emailSettings,
  saveEmailSettings,
  unsubscribe,
} from "@/server/email-service";
import { escapeHtml } from "@/lib/email-templates";

/** A small page for unsubscribe links opened in a browser. */
function page(title: string, body: string, status = 200) {
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;min-height:100svh;display:grid;place-items:center;background:#EEF3F5;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0A2633;">
<main style="max-width:420px;margin:24px;padding:28px;border:1px solid #DCE5EA;border-radius:18px;background:#fff;text-align:center;">
<img src="/email/yuzu-logo.png" width="48" height="48" alt="">
<h1 style="font-size:20px;margin:12px 0 6px;">${escapeHtml(title)}</h1>
<p style="color:#5E7480;font-size:14px;line-height:1.5;margin:0;">${body}</p>
<p style="margin:18px 0 0;"><a href="/settings/notifications" style="color:#0B5A7A;font-weight:700;">Email settings</a></p>
</main></body></html>`,
    {
      status,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      },
    },
  );
}

async function handle(request: Request, action: string) {
  const requestId = crypto.randomUUID();
  // Unsubscribe works without signing in: the signed link is the proof.
  if (action === "unsubscribe") {
    const token = new URL(request.url).searchParams.get("t") ?? "";
    try {
      const { label } = await unsubscribe(token);
      if (request.method === "POST") return new Response(null, { status: 204 });
      return page(
        "You're unsubscribed",
        `You won't get ${escapeHtml(label)} anymore. You can turn them back on in your email settings.`,
      );
    } catch (error) {
      const message =
        error instanceof SetupError
          ? error.message
          : "This link couldn't be used.";
      if (request.method === "POST")
        return Response.json(
          { error: { code: "INVALID_LINK", message }, requestId },
          { status: 400 },
        );
      return page("Link not valid", escapeHtml(message), 400);
    }
  }
  try {
    let data: unknown;
    if (request.method === "GET" && action === "settings")
      data = await emailSettings(request.headers);
    else if (request.method === "POST" && action === "settings")
      data = await saveEmailSettings(
        await readSetupBody(request),
        request.headers,
      );
    else throw new SetupError(404, "NOT_FOUND", "Email action not found.");
    return Response.json(
      { data, requestId },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const invalid = error instanceof z.ZodError;
    const known = error instanceof SetupError;
    if (!known && !invalid) console.error("email request failed", error);
    return Response.json(
      {
        error: {
          code: known
            ? error.code
            : invalid
              ? "INVALID_INPUT"
              : "EMAIL_REQUEST_FAILED",
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
