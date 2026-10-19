import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { createRecordId, getDatabase } from "@yuzu/database";
import { configuredOrigin, digest } from "./setup/security";
import { allowSignIn } from "./auth-rate-limit";

let instance: ReturnType<typeof makeAuth> | undefined;
function makeAuth() {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret || secret.length < 32)
    throw new Error("Installation authentication keys are not configured.");
  return betterAuth({
    baseURL: configuredOrigin(),
    secret,
    advanced: { database: { generateId: () => createRecordId() } },
    database: prismaAdapter(getDatabase(), { provider: "postgresql" }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
    },
    user: {
      additionalFields: {
        role: { type: "string", defaultValue: "MEMBER", input: false },
      },
    },
    session: { cookieCache: { enabled: false } },
    rateLimit: { enabled: true, window: 60, max: 30 },
    logger: { disabled: true },
    databaseHooks: {
      session: {
        create: {
          // Runs after the password check, so it reveals nothing to guessers.
          before: async (session) => {
            const user = await getDatabase().user.findUnique({
              where: { id: session.userId },
              select: { deactivatedAt: true },
            });
            if (user?.deactivatedAt)
              throw new APIError("FORBIDDEN", {
                message:
                  "This account is deactivated. Ask an administrator to reactivate it.",
              });
          },
        },
      },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (
          ctx.path === "/request-password-reset" ||
          ctx.path === "/reset-password" ||
          ctx.path.startsWith("/reset-password/")
        )
          throw new APIError("FORBIDDEN", {
            message: "Use Yuzu's password recovery page.",
          });
        if (
          ctx.path === "/sign-in/email" &&
          typeof ctx.body?.email === "string" &&
          !(await allowSignIn(ctx.body.email))
        )
          throw new APIError("TOO_MANY_REQUESTS", {
            message: "Too many sign-in attempts. Try again later.",
          });
        if (ctx.path === "/change-email")
          throw new APIError("FORBIDDEN", {
            message: "Email changes are not available during installation.",
          });
        if (ctx.path !== "/sign-up/email") return;
        const token = ctx.headers?.get("x-yuzu-owner-intent");
        const claim = token
          ? await getDatabase().setupClaim.findUnique({
              where: { id: "owner" },
            })
          : null;
        if (
          !claim ||
          claim.intentDigest !== digest(token!) ||
          claim.intentExpiresAt <= new Date() ||
          claim.email !== ctx.body?.email?.toLowerCase()
        ) {
          throw new APIError("FORBIDDEN", {
            message:
              "Registration requires authorized installation setup or an invitation.",
          });
        }
        const installation =
          await getDatabase().installationSettings.findUnique({
            where: { id: "installation" },
          });
        if (installation?.ownerId)
          throw new APIError("FORBIDDEN", {
            message: "The initial owner already exists.",
          });
      }),
    },
  });
}
export function getAuth() {
  return (instance ??= makeAuth());
}
