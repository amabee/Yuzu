import { getDatabase } from "@yuzu/database";
import { z } from "zod";
import { presets, savedTheme, previewThemeSchema } from "@/lib/appearance";
import { isAdministrator, requireIdentity } from "./team-access";
import { SetupError } from "./setup/security";

export async function publishedAppearance() {
  const settings = await getDatabase().installationSettings.findUnique({
    where: { id: "installation" },
    select: { theme: true, themeRevision: true },
  });
  return {
    theme: savedTheme(settings?.theme),
    revision: settings?.themeRevision ?? 0,
  };
}
async function administrator(headers: Headers) {
  const identity = await requireIdentity(headers);
  if (!isAdministrator(identity.user.role))
    throw new SetupError(
      403,
      "FORBIDDEN",
      "Only owners and administrators can edit global appearance.",
    );
  return identity;
}
export async function appearanceState(headers: Headers) {
  const { settings } = await administrator(headers);
  const draft = previewThemeSchema.safeParse(settings.themeDraft);
  return {
    theme: savedTheme(settings.theme),
    revision: settings.themeRevision,
    draft: draft.success ? draft.data : null,
    hasPrevious: previewThemeSchema.safeParse(settings.previousTheme).success,
  };
}
const writeSchema = z
  .object({
    revision: z.number().int().nonnegative(),
    theme: previewThemeSchema.optional(),
  })
  .strict();
export async function writeAppearance(
  action: string,
  input: unknown,
  headers: Headers,
) {
  if (!["draft", "publish", "restore", "reset"].includes(action))
    throw new SetupError(404, "NOT_FOUND", "Appearance action not found.");
  const body = writeSchema.parse(input);
  if (["draft", "publish"].includes(action) && !body.theme)
    throw new SetupError(422, "INVALID_INPUT", "Choose a valid theme first.");
  const { user } = await administrator(headers);
  await getDatabase().$transaction(async (tx) => {
    const currentUser = await tx.user.findUnique({ where: { id: user.id } });
    if (!currentUser || !isAdministrator(currentUser.role))
      throw new SetupError(
        403,
        "FORBIDDEN",
        "Administrator access is required.",
      );
    const settings = await tx.installationSettings.findUniqueOrThrow({
      where: { id: "installation" },
    });
    if (settings.themeRevision !== body.revision)
      throw new SetupError(
        409,
        "THEME_CHANGED",
        "Another administrator published a theme. Export your draft, then reload to review their changes.",
      );
    const previous = previewThemeSchema.safeParse(settings.previousTheme);
    if (action === "restore" && !previous.success)
      throw new SetupError(
        409,
        "NO_PREVIOUS_THEME",
        "There is no previous theme to restore.",
      );
    const theme =
      action === "reset"
        ? presets[0]
        : action === "restore" && previous.success
          ? previous.data
          : body.theme!;
    const result = await tx.installationSettings.updateMany({
      where: { id: "installation", themeRevision: body.revision },
      data:
        action === "draft"
          ? { themeDraft: theme }
          : {
              theme,
              themeDraft: theme,
              previousTheme: savedTheme(settings.theme),
              themeRevision: { increment: 1 },
            },
    });
    if (!result.count)
      throw new SetupError(
        409,
        "THEME_CHANGED",
        "The published theme changed. Export your draft and reload.",
      );
  });
  return appearanceState(headers);
}
