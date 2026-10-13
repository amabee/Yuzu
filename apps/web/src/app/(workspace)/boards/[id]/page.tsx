import { notFound } from "next/navigation";
import { getDatabase } from "@yuzu/database";
import { workspaceContext } from "@/server/workspace-access";
import { Columns3 } from "lucide-react";

export default async function BoardPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { settings } = await workspaceContext();
  const board = await getDatabase().board.findFirst({
    where: {
      id: (await params).id,
      workspaceId: settings.initialWorkspaceId ?? "",
    },
    include: { columns: { orderBy: { position: "asc" } }, groups: true },
  });
  if (!board) notFound();
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
      <div className="mt-8 overflow-x-auto rounded-xl border bg-card">
        <table className="w-full min-w-[700px] text-left text-sm">
          <caption className="sr-only">{board.name} fields</caption>
          <thead>
            <tr>
              {board.columns.map((column) => (
                <th
                  scope="col"
                  key={column.id}
                  className="border-b px-5 py-4 font-medium"
                >
                  {column.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td colSpan={board.columns.length} className="p-12 text-center">
                <Columns3 size={26} className="mx-auto mb-4 text-primary" />
                <p className="font-medium">
                  A clean start for{" "}
                  {board.groups[0]?.name.toLowerCase() ?? "your tasks"}.
                </p>
                <p className="mt-2 text-sm text-muted-foreground">
                  No sample records were created during installation.
                </p>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
