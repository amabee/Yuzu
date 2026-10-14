import Link from "next/link";
import {
  ArrowRight,
  Columns3,
  FolderOpen,
  CheckCheck,
  Settings2,
} from "lucide-react";
import { getDatabase } from "@yuzu/database";
import { workspaceContext } from "@/server/workspace-access";
import { workspaceScope } from "@/server/team-access";
export default async function OverviewPage() {
  const { user, workspace, workspaces } = await workspaceContext();
  const boards = await getDatabase().board.findMany({
    where: { workspace: workspaceScope(user) },
    include: {
      workspace: { select: { name: true } },
      _count: { select: { columns: true, groups: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  return (
    <div>
      <div className="workspace-breadcrumb">
        <span>Workspaces</span>
        <span>/</span>
        <span>{workspace?.name ?? "Overview"}</span>
      </div>
      <div className="workspace-page-heading">
        <div>
          <h1 className="text-2xl sm:text-3xl">Good work starts here.</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Your projects, your people, and a shared place to move things
            forward.
          </p>
        </div>
        <Link
          href="/boards"
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm text-primary-foreground"
        >
          View boards
          <ArrowRight size={15} />
        </Link>
      </div>
      <div className="workspace-metrics">
        <div>
          <Columns3 size={20} />
          <span>Boards</span>
          <strong>{boards.length}</strong>
        </div>
        <div>
          <FolderOpen size={20} />
          <span>Workspaces</span>
          <strong>{workspaces.length}</strong>
        </div>
        <div>
          <Settings2 size={20} />
          <span>Saved fields</span>
          <strong>
            {boards.reduce((count, board) => count + board._count.columns, 0)}
          </strong>
        </div>
      </div>
      <section className="workspace-projects">
        <header>
          <h2>Your boards</h2>
          <Link href="/boards">
            View all
            <ArrowRight size={14} />
          </Link>
        </header>
        <div className="workspace-board-grid">
          {boards.map((board) => (
            <Link
              href={`/boards/${board.id}`}
              key={board.id}
              className="workspace-board-card bg-card"
            >
              <div className="workspace-board-card-top">
                <span>
                  <Columns3 size={22} />
                </span>
                <ArrowRight size={16} />
              </div>
              <p>{board.workspace.name}</p>
              <h3>{board.name}</h3>
              <div className="workspace-board-card-footer">
                <span>{board._count.columns} fields</span>
                <span>{board._count.groups} groups</span>
              </div>
            </Link>
          ))}
          {!boards.length && (
            <div className="workspace-empty">
              <FolderOpen size={25} />
              <h3>Your projects will live here</h3>
              <p>Ask an owner or administrator for workspace access.</p>
            </div>
          )}
        </div>
      </section>
      <div className="workspace-quick-links">
        <Link href="/approvals">
          <CheckCheck size={20} />
          <div>
            <h2>Approvals</h2>
            <p>Keep decisions connected to the work.</p>
          </div>
          <ArrowRight size={16} />
        </Link>
        <Link href="/settings">
          <Settings2 size={20} />
          <div>
            <h2>Workspace settings</h2>
            <p>Shape the way your team works.</p>
          </div>
          <ArrowRight size={16} />
        </Link>
      </div>
    </div>
  );
}
