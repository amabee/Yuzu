import { notFound } from "next/navigation";
import { getDatabase } from "@yuzu/database";
import { workspaceContext } from "@/server/workspace-access";
import { boardScope, isAdministrator } from "@/server/team-access";
import { visibleProjects } from "@/server/project-service";
import { MoveBoard } from "@/components/projects/move-board";
import { BoardSurface } from "@/components/boards/board-surface";
import Link from "next/link";
import { Rocket, ChevronRight } from "lucide-react";
import { headers } from "next/headers";
import { boardState } from "@/server/board-service";
import { z } from "zod";
import { ProjectBadge } from "@/components/projects/project-badge";

export default async function BoardPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ task?: string; tab?: string }>;
}) {
  const { user } = await workspaceContext();
  const board = await getDatabase().board.findFirst({
    where: {
      id: (await params).id,
      ...boardScope(user),
    },
    include: {
      columns: { orderBy: { position: "asc" } },
      groups: { orderBy: { position: "asc" } },
      workspace: { select: { name: true } },
      project: {
        select: { id: true, name: true, color: true, archivedAt: true },
      },
      createdBy: { select: { name: true } },
      managers: { where: { userId: user.id }, select: { userId: true } },
    },
  });
  if (!board) notFound();
  // Offer "Move to…" only where the server would allow at least one move.
  const projects = await visibleProjects(user, {
    workspaceId: board.workspaceId,
    archived: false,
  });
  const manageBoard = isAdministrator(user.role) || board.managers.length > 0;
  const manageSource = board.projectId
    ? Boolean(projects.find((item) => item.id === board.projectId)?.canManage)
    : manageBoard;
  const moveTargets = projects
    .filter((item) => item.canManage || item.id === board.projectId)
    .map(({ id, name, color, visibility }) => ({
      id,
      name,
      color,
      visibility,
    }));
  const canMove =
    manageSource &&
    !board.project?.archivedAt &&
    (moveTargets.some((item) => item.id !== board.projectId) ||
      (board.projectId !== null && manageBoard));
  const status = z
    .object({ options: z.array(z.object({ label: z.string() })) })
    .safeParse(
      board.columns.find((column) => column.type === "STATUS")?.config,
    );
  const initialState = await boardState(board.id, await headers(), {
    selectedView: true,
    taskId: z
      .string()
      .uuid()
      .safeParse((await searchParams).task).data,
  });
  return (
    <div>
      <nav aria-label="Breadcrumb" className="workspace-breadcrumb">
        <Link href="/boards">{board.workspace.name}</Link>
        <ChevronRight size={13} />
        {board.project && (
          <>
            <Link
              href={`/projects/${board.project.id}`}
              className="flex items-center gap-1.5"
            >
              <ProjectBadge
                name={board.project.name}
                color={board.project.color}
              />
              {board.project.name}
            </Link>
            <ChevronRight size={13} />
          </>
        )}
        <span aria-current="page">{board.name}</span>
        {board.project?.archivedAt && (
          <span className="rounded-full bg-muted px-2 py-0.5">
            Archived project, read-only
          </span>
        )}
      </nav>
      <div className="project-heading">
        <div className="project-symbol">
          <Rocket size={27} />
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl sm:text-3xl">{board.name}</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Plan, organize, and keep your team’s work in view.
          </p>
        </div>
        {canMove && (
          <MoveBoard
            board={{ id: board.id, name: board.name }}
            currentProjectId={board.projectId}
            targets={moveTargets}
          />
        )}
        <div className="project-owner">
          <span>{board.createdBy.name.charAt(0).toUpperCase()}</span>
          <div>
            <small>Created by</small>
            <b>{board.createdBy.name}</b>
          </div>
        </div>
      </div>
      <BoardSurface
        key={board.id}
        initialCommentsTab={(await searchParams).tab === "comments"}
        initialTaskId={
          z
            .string()
            .uuid()
            .safeParse((await searchParams).task).data
        }
        initialState={initialState}
        name={board.name}
        fields={board.columns}
        statuses={
          status.success
            ? status.data.options.map((option) => option.label)
            : []
        }
        group={board.groups[0]?.name ?? "Your tasks"}
        info={{
          workspace: board.workspace.name,
          creator: board.createdBy.name,
          createdAt: board.createdAt.toISOString(),
          groups: board.groups.map((item) => item.name),
        }}
      />
    </div>
  );
}
