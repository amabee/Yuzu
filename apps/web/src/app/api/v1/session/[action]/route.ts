import { z } from "zod";
import { getAuth } from "@/server/auth";
import { readSetupBody, SetupError } from "@/server/setup/security";

export async function POST(
  request: Request,
  context: { params: Promise<{ action: string }> },
) {
  const requestId = crypto.randomUUID();
  try {
    const { action } = await context.params;
    const body = await readSetupBody(request);
    let authResponse: Response;
    if (action === "sign-in") {
      const credentials = z
        .strictObject({
          email: z.email().max(254),
          password: z.string().min(1).max(128),
        })
        .parse(body);
      authResponse = await getAuth().api.signInEmail({
        body: credentials,
        headers: request.headers,
        asResponse: true,
      });
    } else if (action === "sign-out")
      authResponse = await getAuth().api.signOut({
        headers: request.headers,
        asResponse: true,
      });
    else throw new SetupError(404, "NOT_FOUND", "Session action not found.");
    if (authResponse.status === 429)
      throw new SetupError(
        429,
        "RATE_LIMITED",
        "Too many sign-in attempts. Try again later.",
      );
    // Only a deactivated account is refused after a correct password.
    if (action === "sign-in" && authResponse.status === 403)
      throw new SetupError(
        403,
        "DEACTIVATED",
        "This account is deactivated. Ask an administrator to reactivate it.",
      );
    if (!authResponse.ok)
      throw new SetupError(
        401,
        "SIGN_IN_FAILED",
        "Check your email and password, then try again.",
      );
    const headers = new Headers({ "Cache-Control": "no-store" });
    authResponse.headers
      .getSetCookie()
      .forEach((cookie) => headers.append("Set-Cookie", cookie));
    return Response.json({ data: { saved: true }, requestId }, { headers });
  } catch (error) {
    const rateLimited =
      typeof error === "object" &&
      error !== null &&
      (("statusCode" in error && error.statusCode === 429) ||
        ("status" in error && error.status === "TOO_MANY_REQUESTS"));
    if (rateLimited)
      return Response.json(
        {
          error: {
            code: "RATE_LIMITED",
            message: "Too many sign-in attempts. Try again later.",
          },
          requestId,
        },
        {
          status: 429,
          headers: { "Cache-Control": "no-store", "Retry-After": "600" },
        },
      );
    return Response.json(
      {
        error: {
          code: error instanceof SetupError ? error.code : "SIGN_IN_FAILED",
          message:
            error instanceof SetupError
              ? error.message
              : "Sign-in could not finish. Check your credentials and try again.",
        },
        requestId,
      },
      {
        status: error instanceof SetupError ? error.status : 422,
        headers: {
          "Cache-Control": "no-store",
          ...(error instanceof SetupError && error.status === 429
            ? { "Retry-After": "600" }
            : {}),
        },
      },
    );
  }
}
