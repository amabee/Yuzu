import type { DatabaseTransaction } from "@yuzu/database";
import { isAdministrator, projectScope } from "./team-access";
import { SetupError } from "./setup/security";

/** Loads a project the user may see, with their role in it.
 *  Missing and hidden (private, non-member) projects look identical. */
export async function projectAccess(
  tx: DatabaseTransaction,
  user: { id: string; role: string },
  projectId: string,
) {
  const project = await tx.project.findFirst({
    where: { id: projectId, ...projectScope(user) },
    include: { members: { where: { userId: user.id } } },
  });
  if (!project)
    throw new SetupError(404, "NOT_FOUND", "This project is not available.");
  const membership = project.members[0] ?? null;
  return {
    project,
    membership,
    // Managers run the project. Admins can manage public projects; private ones
    // they only reach through audited recovery, which makes them a manager.
    canManage:
      membership?.role === "MANAGER" ||
      (isAdministrator(user.role) && project.visibility === "PUBLIC"),
  };
}
