import { notFound } from "next/navigation";
import { getDatabase } from "@yuzu/database";
import { workspaceContext } from "@/server/workspace-access";
import { workspaceScope } from "@/server/team-access";
import { BoardSurface } from "@/components/boards/board-surface";
import Link from "next/link";
import { Rocket, ChevronRight } from "lucide-react";
import { headers } from "next/headers";
import { boardState } from "@/server/board-service";
import { z } from "zod";

export default async function BoardPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ task?: string }>;
}) {
  const { user } = await workspaceContext();
  const board = await getDatabase().board.findFirst({
    where: {
      id: (await params).id,
      workspace: workspaceScope(user),
    },
    include: {
      columns: { orderBy: { position: "asc" } },
      groups: { orderBy: { position: "asc" } },
      workspace: { select: { name: true } },
      createdBy: { select: { name: true } },
    },
  });
  if (!board) notFound();
  const status = z
    .object({ options: z.array(z.object({ label: z.string() })) })
    .safeParse(
      board.columns.find((column) => column.type === "STATUS")?.config,
    );
  const initialState = await boardState(board.id, await headers());
  return (
    <div>
      <div className="workspace-breadcrumb">
        <Link href="/boards">Workspaces</Link>
        <ChevronRight size={13} />
        <span>{board.workspace.name}</span>
      </div>
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
        <div className="project-owner">
          <span>{board.createdBy.name.charAt(0).toUpperCase()}</span>
          <div>
            <small>Created by</small>
            <b>{board.createdBy.name}</b>
          </div>
        </div>
      </div>
      <BoardSurface
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
