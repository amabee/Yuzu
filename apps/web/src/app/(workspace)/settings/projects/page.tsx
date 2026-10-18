import Link from "next/link";
import { forbidden } from "next/navigation";
import { Lock, Users } from "lucide-react";
import { getDatabase } from "@yuzu/database";
import { workspaceContext } from "@/server/workspace-access";
import { isAdministrator } from "@/server/team-access";
import { ProjectBadge } from "@/components/projects/project-badge";
import { RecoverProject } from "@/components/projects/recover-project";
import { RestoreProject } from "@/components/projects/restore-project";

export const metadata = { title: "Projects directory" };

export default async function ProjectsDirectoryPage() {
  const { user } = await workspaceContext();
  if (!isAdministrator(user.role)) forbidden();
  // Names and managers only: private projects' boards and contents stay
  // hidden until an administrator deliberately recovers access.
  const projects = await getDatabase().project.findMany({
    orderBy: [{ workspaceId: "asc" }, { position: "asc" }],
    take: 500,
    select: {
      id: true,
      name: true,
      color: true,
      visibility: true,
      archivedAt: true,
      workspace: { select: { name: true } },
      members: {
        where: { OR: [{ role: "MANAGER" }, { userId: user.id }] },
        select: { role: true, user: { select: { id: true, name: true } } },
      },
    },
  });
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-3xl font-semibold">Projects directory</h1>
      <p className="mt-3 mb-8 text-sm leading-6 text-muted-foreground">
        Every project in this installation. Private projects show only their
        name and managers. If a private project has lost its managers, you can
        recover access; the managers are notified and the action is recorded.
      </p>
      {projects.length === 0 ? (
        <p className="text-sm text-muted-foreground">No projects yet.</p>
      ) : (
        <ul className="project-boards" aria-label="Projects">
          {projects.map((project) => {
            const isPrivate = project.visibility === "PRIVATE";
            const member = project.members.some(
              (item) => item.user.id === user.id,
            );
            const managers = project.members
              .filter((item) => item.role === "MANAGER")
              .map((item) => item.user.name);
            const visible = !isPrivate || member;
            return (
              <li key={project.id} className="project-board-row">
                <div className="flex min-w-0 items-center gap-3">
                  <ProjectBadge name={project.name} color={project.color} />
                  <div className="min-w-0">
                    {visible && !project.archivedAt ? (
                      <Link href={`/projects/${project.id}`}>
                        {project.name}
                      </Link>
                    ) : (
                      <span className="font-semibold">{project.name}</span>
                    )}
                    <small>
                      {project.workspace.name}.{" "}
                      {managers.length
                        ? `Managed by ${managers.join(", ")}`
                        : "No managers"}
                      {project.archivedAt ? ". Archived" : ""}
                    </small>
                  </div>
                </div>
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  {isPrivate ? <Lock size={13} /> : <Users size={13} />}
                  {isPrivate ? "Private" : "Workspace"}
                </span>
                <div className="flex justify-end gap-2">
                  {isPrivate && !member && (
                    <RecoverProject
                      project={{ id: project.id, name: project.name }}
                    />
                  )}
                  {project.archivedAt && visible && (
                    <RestoreProject projectId={project.id} />
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
