import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight, Lock, Users } from "lucide-react";
import { getDatabase } from "@yuzu/database";
import { workspaceContext } from "@/server/workspace-access";
import { isAdministrator, projectScope } from "@/server/team-access";
import { COMPLETED_STATUS_ID } from "@/lib/dashboard-contract";
import { calendarWindow } from "@/lib/board-query";
import { ProjectBadge } from "@/components/projects/project-badge";
import { ProjectActions } from "@/components/projects/project-actions";
import { MoveBoard } from "@/components/projects/move-board";
import { RestoreProject } from "@/components/projects/restore-project";
import { visibleProjects } from "@/server/project-service";

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { user, settings } = await workspaceContext();
  const db = getDatabase();
  const project = await db.project.findFirst({
    where: { id: (await params).id, ...projectScope(user) },
    include: {
      workspace: { select: { id: true, name: true } },
      members: {
        orderBy: [{ role: "asc" }, { createdAt: "asc" }],
        take: 200,
        select: {
          role: true,
          projectOnly: true,
          user: { select: { id: true, name: true, email: true } },
        },
      },
      boards: {
        orderBy: [{ position: "asc" }, { createdAt: "asc" }],
        take: 200,
        select: { id: true, name: true },
      },
    },
  });
  if (!project) notFound();
  const role = project.members.find((item) => item.user.id === user.id)?.role;
  const canManage =
    role === "MANAGER" ||
    (isAdministrator(user.role) && project.visibility === "PUBLIC");
  // Archived projects are read-only until restored.
  const canChange = canManage && !project.archivedAt;
  const boardIds = project.boards.map((board) => board.id);
  // "This week" follows the installation's timezone, like the Overview.
  const { start, end } = calendarWindow(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: settings.timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date()),
  );
  const [deadlines, pending] = await Promise.all([
    db.task.findMany({
      where: {
        boardId: { in: project.boards.map((board) => board.id) },
        archivedAt: null,
        dueDate: { gte: start, lte: end },
        OR: [{ statusId: null }, { statusId: { not: COMPLETED_STATUS_ID } }],
      },
      orderBy: [{ dueDate: "asc" }, { id: "asc" }],
      take: 8,
      select: {
        id: true,
        name: true,
        dueDate: true,
        board: { select: { id: true, name: true } },
      },
    }),
    // Counts only: proposal contents stay on the Approvals page, where
    // approver permissions apply.
    db.boardProposal.groupBy({
      by: ["boardId"],
      where: {
        boardId: { in: project.boards.map((board) => board.id) },
        status: "PENDING",
      },
      _count: true,
    }),
  ]);
  const [totals, completed] = await Promise.all([
    db.task.groupBy({
      by: ["boardId"],
      where: { boardId: { in: boardIds }, archivedAt: null },
      _count: true,
    }),
    db.task.groupBy({
      by: ["boardId"],
      where: {
        boardId: { in: boardIds },
        archivedAt: null,
        statusId: COMPLETED_STATUS_ID,
      },
      _count: true,
    }),
  ]);
  const count = (rows: typeof totals, id: string) =>
    rows.find((row) => row.boardId === id)?._count ?? 0;
  const memberIds = project.members.map((item) => item.user.id);
  // Managers need the add list, pending invites and the privacy impact.
  const [candidates, invitations, outsiders] = canManage
    ? await Promise.all([
        db.user.findMany({
          where: {
            id: { notIn: memberIds },
            memberships: { some: { workspaceId: project.workspaceId } },
          },
          orderBy: { name: "asc" },
          take: 200,
          select: { id: true, name: true, email: true },
        }),
        db.projectInvitation.findMany({
          where: {
            projectId: project.id,
            acceptedAt: null,
            revokedAt: null,
            expiresAt: { gt: new Date() },
          },
          orderBy: { createdAt: "desc" },
          take: 100,
          select: { id: true, email: true, role: true },
        }),
        db.user.count({
          where: {
            id: { notIn: memberIds },
            OR: [
              { role: { in: ["OWNER", "ADMIN"] } },
              {
                memberships: {
                  some: { workspaceId: project.workspaceId },
                },
              },
            ],
          },
        }),
      ])
    : [[], [], 0];
  const moveTargets = canManage
    ? (
        await visibleProjects(user, {
          workspaceId: project.workspaceId,
          archived: false,
        })
      )
        .filter((item) => item.canManage)
        .map(({ id, name, color, visibility }) => ({
          id,
          name,
          color,
          visibility,
        }))
    : [];
  const isPrivate = project.visibility === "PRIVATE";
  return (
    <div>
      <nav aria-label="Breadcrumb" className="workspace-breadcrumb">
        <Link href="/boards">{project.workspace.name}</Link>
        <ChevronRight size={13} />
        <span aria-current="page">{project.name}</span>
      </nav>
      {project.archivedAt && (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-muted px-4 py-3 text-sm">
          <span>
            This project is archived. Its boards are read-only and hidden from
            navigation.
          </span>
          {canManage && <RestoreProject projectId={project.id} />}
        </div>
      )}
      <header className="project-hero">
        <ProjectBadge name={project.name} color={project.color} size="lg" />
        <div className="min-w-0">
          <h1>{project.name}</h1>
          <p className="project-pill">
            {isPrivate ? <Lock size={13} /> : <Users size={13} />}
            {isPrivate
              ? `Private, ${project.members.length} ${project.members.length === 1 ? "member" : "members"}`
              : `Visible to ${project.workspace.name}`}
          </p>
        </div>
        <div className="project-hero-actions">
          <div className="project-avatars" aria-label="Project members">
            {project.members.slice(0, 5).map((member) => (
              <span key={member.user.id} title={member.user.name}>
                {member.user.name.charAt(0).toUpperCase()}
              </span>
            ))}
          </div>
          <ProjectActions
            project={{
              id: project.id,
              name: project.name,
              color: project.color,
              visibility: project.visibility as "PUBLIC" | "PRIVATE",
              revision: project.revision,
              boardCount: project.boards.length,
            }}
            workspaceName={project.workspace.name}
            canManage={canChange}
            viewerId={user.id}
            members={project.members.map((member) => ({
              id: member.user.id,
              name: member.user.name,
              email: member.user.email,
              role: member.role as "MANAGER" | "MEMBER",
              projectOnly: member.projectOnly,
            }))}
            candidates={candidates}
            invitations={invitations.map((invite) => ({
              ...invite,
              role: invite.role as "MANAGER" | "MEMBER",
            }))}
            outsiders={outsiders}
          />
        </div>
      </header>
      {project.boards.length === 0 ? (
        <div className="project-empty">
          <h2 className="text-lg font-semibold">
            No boards in this project yet
          </h2>
          <p className="text-sm text-muted-foreground">
            {canManage
              ? "Create a board here, or move an existing one in from its page."
              : "A project manager can add boards here."}
          </p>
        </div>
      ) : (
        <section aria-label="Boards" className="project-boards">
          {project.boards.map((board) => {
            const total = count(totals, board.id);
            const done = count(completed, board.id);
            const percent = total ? Math.round((done / total) * 100) : 0;
            return (
              <div key={board.id} className="project-board-row">
                <div className="min-w-0">
                  <Link href={`/boards/${board.id}`}>{board.name}</Link>
                  <small>
                    {total === 0
                      ? "No tasks yet"
                      : `${done} of ${total} tasks done`}
                  </small>
                </div>
                <div className="project-progress-cell">
                  <div
                    className="project-progress"
                    role="progressbar"
                    aria-label={`${board.name} progress`}
                    aria-valuenow={percent}
                    aria-valuemin={0}
                    aria-valuemax={100}
                  >
                    <span style={{ width: `${percent}%` }} />
                  </div>
                </div>
                <div>
                  {canChange && (
                    <MoveBoard
                      board={board}
                      currentProjectId={project.id}
                      targets={moveTargets}
                      variant="ghost"
                    />
                  )}
                </div>
              </div>
            );
          })}
        </section>
      )}
      {project.boards.length > 0 && (
        <div className="project-panels">
          <section aria-labelledby="project-deadlines">
            <h2 id="project-deadlines">Deadlines this week</h2>
            {deadlines.length === 0 ? (
              <p className="project-panel-empty">
                Nothing open is due in the next 7 days.
              </p>
            ) : (
              <ul>
                {deadlines.map((task) => (
                  <li key={task.id}>
                    <Link href={`/boards/${task.board.id}?task=${task.id}`}>
                      {task.name}
                    </Link>
                    <small>
                      {task.board.name},{" "}
                      {new Intl.DateTimeFormat("en", {
                        weekday: "short",
                        month: "short",
                        day: "numeric",
                        timeZone: "UTC",
                      }).format(task.dueDate!)}
                    </small>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section aria-labelledby="project-approvals">
            <h2 id="project-approvals">Waiting on approval</h2>
            {pending.length === 0 ? (
              <p className="project-panel-empty">No changes are waiting.</p>
            ) : (
              <ul>
                {pending.map((row) => (
                  <li key={row.boardId}>
                    <Link href="/approvals">
                      {row._count} {row._count === 1 ? "change" : "changes"}
                    </Link>
                    <small>
                      {
                        project.boards.find((board) => board.id === row.boardId)
                          ?.name
                      }
                    </small>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
