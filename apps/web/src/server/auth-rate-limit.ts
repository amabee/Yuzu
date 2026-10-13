import { getDatabase } from "@yuzu/database";
import { digest } from "./setup/security";

export async function allowSignIn(email: string): Promise<boolean> {
  const db = getDatabase();
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await db.$transaction(
        async (tx) => {
          const now = new Date();
          for (const rule of [
            { id: "sign-in-global", limit: 100, window: 60_000 },
            {
              id: `sign-in:${digest(email.trim().toLowerCase())}`,
              limit: 10,
              window: 600_000,
            },
          ]) {
            const current = await tx.authenticationAttempt.findUnique({
              where: { id: rule.id },
            });
            if (
              current &&
              now.getTime() - current.windowStart.getTime() < rule.window
            ) {
              if (current.count >= rule.limit) return false;
              await tx.authenticationAttempt.update({
                where: { id: rule.id },
                data: { count: { increment: 1 } },
              });
            } else
              await tx.authenticationAttempt.upsert({
                where: { id: rule.id },
                create: { id: rule.id, count: 1, windowStart: now },
                update: { count: 1, windowStart: now },
              });
          }
          await tx.authenticationAttempt.deleteMany({
            where: {
              windowStart: { lt: new Date(now.getTime() - 86_400_000) },
            },
          });
          return true;
        },
        { isolationLevel: "Serializable" },
      );
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "P2034" &&
        attempt < 2
      )
        continue;
      throw error;
    }
  }
  return false;
}
