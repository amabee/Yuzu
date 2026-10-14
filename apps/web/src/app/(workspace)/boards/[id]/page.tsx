import { notFound } from "next/navigation";
import { getDatabase } from "@yuzu/database";
import { workspaceContext } from "@/server/workspace-access";
import { workspaceScope } from "@/server/team-access";
import { BoardSurface } from "@/components/boards/board-surface";
import { z } from "zod";

export default async function BoardPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { user } = await workspaceContext();
  const board = await getDatabase().board.findFirst({
    where: {
      id: (await params).id,
      workspace: workspaceScope(user),
    },
    include: { columns: { orderBy: { position: "asc" } }, groups: true },
  });
  if (!board) notFound();
  const status = z
    .object({ options: z.array(z.object({ label: z.string() })) })
    .safeParse(
      board.columns.find((column) => column.type === "STATUS")?.config,
    );
  return (
    <div>
      <p className="mb-2 text-[11px] font-semibold tracking-[0.15em] text-brand-secondary uppercase">
        Project board
      </p>
      <h1 className="text-3xl font-semibold tracking-tight">{board.name}</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        Your board structure is saved. Task editing arrives in the board-engine
        milestone.
      </p>
      <BoardSurface
        name={board.name}
        fields={board.columns}
        statuses={
          status.success
            ? status.data.options.map((option) => option.label)
            : []
        }
        group={board.groups[0]?.name ?? "Your tasks"}
      />
    </div>
  );
}
