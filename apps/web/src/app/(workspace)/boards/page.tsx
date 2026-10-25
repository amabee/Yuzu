import { workBoardWhere } from "@/lib/record-types";
import Link from "next/link";
import { PageCrumbs } from "@/components/page-crumbs";
import { getDatabase } from "@yuzu/database";
import { workspaceContext } from "@/server/workspace-access";
import { boardScope } from "@/server/team-access";
import { CreateBoard } from "@/components/boards/create-board";
import { isAdministrator } from "@/server/team-access";
import { ArrowRight, Columns3 } from "lucide-react";

export const metadata = { title: "Boards" };
export default async function BoardsPage({
  searchParams,
}: {
  searchParams: Promise<{ archived?: string }>;
}) {
  const archived = (await searchParams).archived === "true";
  const { user, workspaces } = await workspaceContext();
  const boards = await getDatabase().board.findMany({
    where: {
      AND: [
        boardScope(user),
        workBoardWhere,
        archived
          ? {
              OR: [
                { archivedAt: { not: null } },
                { project: { is: { archivedAt: { not: null } } } },
              ],
            }
          : {
              archivedAt: null,
              OR: [
                { projectId: null },
                { project: { is: { archivedAt: null } } },
              ],
            },
      ],
    },
    take: 200,
    orderBy: [{ name: "asc" }, { id: "asc" }],
    select: {
      managers: { select: { userId: true } },
      createdById: true,
      id: true,
      name: true,
      archivedAt: true,
      project: { select: { archivedAt: true } },
      workspace: { select: { name: true } },
      _count: { select: { columns: true, groups: true } },
    },
  });
  return (
    <div>
      <PageCrumbs items={[{ label: "Boards" }]} />
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-3xl font-semibold tracking-tight">Boards</h1>
        {(isAdministrator(user.role) ||
          boards.some((board) =>
            board.managers.some((manager) => manager.userId === user.id),
          )) && <CreateBoard workspaces={workspaces} />}
      </div>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">
        Your projects, with room to grow.
      </p>
      <Link
        href={archived ? "/boards" : "/boards?archived=true"}
        className="mt-4 inline-block text-sm text-primary underline underline-offset-4"
      >
        {archived ? "Show active boards" : "Show archived boards"}
      </Link>
      <div className="workspace-board-grid mt-6">
        {boards.length === 0 && (
          <p className="rounded-xl border bg-card p-6 text-sm text-muted-foreground">
            {archived
              ? "No archived boards are available to you."
              : "No active boards are available to you. Create one or ask for workspace access."}
          </p>
        )}
        {boards.map((board) => (
          <Link
            key={board.id}
            href={`/boards/${board.id}`}
            className="workspace-board-card bg-card"
          >
            <div className="workspace-board-card-top">
              <span>
                <Columns3 size={22} />
              </span>
              <ArrowRight size={16} />
            </div>
            <p>{board.workspace.name}</p>
            <h2 className="text-lg font-semibold">{board.name}</h2>
            {(board.archivedAt || board.project?.archivedAt) && (
              <span className="text-xs text-muted-foreground">
                {board.archivedAt ? "Archived" : "Archived project"}
              </span>
            )}
            <div className="workspace-board-card-footer">
              <span>{board._count.columns} fields</span>
              <span>{board._count.groups} groups</span>
            </div>
            <span className="mt-6 flex items-center gap-2 text-sm text-primary">
              Open board
              <ArrowRight size={15} />
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
