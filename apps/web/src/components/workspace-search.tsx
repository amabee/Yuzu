"use client";
import { useState } from "react";
import Link from "next/link";
import { Search, Columns3, FolderOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
export type NavigationWorkspace = {
  id: string;
  name: string;
  boards: { id: string; name: string }[];
};
export function WorkspaceSearch({
  workspaces,
}: {
  workspaces: NavigationWorkspace[];
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const term = query.trim().toLocaleLowerCase();
  const results = workspaces
    .flatMap((workspace) =>
      workspace.boards.map((board) => ({
        ...board,
        workspace: workspace.name,
      })),
    )
    .filter((board) =>
      `${board.name} ${board.workspace}`.toLocaleLowerCase().includes(term),
    );
  return (
    <>
      <Button
        variant="ghost"
        className="workspace-search-trigger"
        aria-label="Search workspace"
        onClick={() => setOpen(true)}
      >
        <Search size={17} />
        <span>Search boards and workspaces…</span>
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="workspace-search-panel">
          <SheetTitle>Search your workspace</SheetTitle>
          <SheetDescription>
            Find a board by its name or workspace.
          </SheetDescription>
          <Input
            aria-label="Search boards"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search boards and workspaces…"
          />
          <div className="space-y-2 overflow-y-auto">
            {results.map((board) => (
              <Link
                key={board.id}
                href={`/boards/${board.id}`}
                onClick={() => setOpen(false)}
                className="flex items-center gap-3 rounded-lg border bg-card p-4 hover:bg-secondary"
              >
                <Columns3 size={18} className="text-primary" />
                <div>
                  <p className="text-sm font-medium">{board.name}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {board.workspace}
                  </p>
                </div>
              </Link>
            ))}
            {!results.length && (
              <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
                <FolderOpen size={22} className="mb-3" />
                No matching boards. Try another name.
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
