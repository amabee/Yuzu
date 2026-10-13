import Link from "next/link";
import { getDatabase } from "@yuzu/database";
import { workspaceContext } from "@/server/workspace-access";
import { ArrowRight, Columns3 } from "lucide-react";

export const metadata = { title: "Boards" };
export default async function BoardsPage() {
  const { settings } = await workspaceContext();
  const boards = await getDatabase().board.findMany({
    where: { workspaceId: settings.initialWorkspaceId ?? "" },
    select: { id: true, name: true },
  });
  return (
    <div>
      <p className="mb-2 text-[11px] font-semibold tracking-[0.15em] text-brand-secondary uppercase">
        Your workspace
      </p>
      <h1 className="text-3xl font-semibold tracking-tight">Boards</h1>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">
        Your projects, with room to grow.
      </p>
      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        {boards.map((board) => (
          <Link
            key={board.id}
            href={`/boards/${board.id}`}
            className="rounded-xl border bg-card p-6 hover:border-primary/40"
          >
            <Columns3 className="mb-5 text-primary" size={23} />
            <h2 className="text-lg font-semibold">{board.name}</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Created during installation · no sample tasks
            </p>
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
