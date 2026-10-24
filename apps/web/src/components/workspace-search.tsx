"use client";
import { PauseAlert } from "@/components/pause/pause-alert";
import { PauseSheetDecor } from "@/components/pause/pause-sheet";
import { useState, useEffect } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import Link from "next/link";
import {
  Search,
  Columns3,
  FolderOpen,
  CheckCheck,
  LoaderCircle,
} from "lucide-react";
import { useSidebar } from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { apiRequest } from "@/lib/api-client";
import { taskSearchResultSchema } from "@/lib/task-search-contract";
export const WORKSPACE_SEARCH_EVENT = "yuzu:open-workspace-search";

export type NavigationWorkspace = {
  id: string;
  name: string;
  boards: { id: string; name: string; projectId?: string | null }[];
};
export function WorkspaceSearch({
  workspaces,
  principalId,
}: {
  workspaces: NavigationWorkspace[];
  principalId: string;
}) {
  const [open, setOpen] = useState(false);
  const { setOpenMobile } = useSidebar();
  const [query, setQuery] = useState("");
  const [archived, setArchived] = useState(false);
  const [term, setTerm] = useState("");
  // Ctrl+K (or Cmd+K) opens search from anywhere in the workspace.
  useEffect(() => {
    const openSearch = () => {
      setOpenMobile(false);
      setOpen(true);
    };
    const onKey = (event: KeyboardEvent) => {
      if (
        event.key.toLowerCase() === "k" &&
        (event.ctrlKey || event.metaKey) &&
        !event.altKey
      ) {
        event.preventDefault();
        openSearch();
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener(WORKSPACE_SEARCH_EVENT, openSearch);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(WORKSPACE_SEARCH_EVENT, openSearch);
    };
  }, [setOpenMobile]);
  useEffect(() => {
    const timer = setTimeout(() => setTerm(query.trim()), 250);
    return () => clearTimeout(timer);
  }, [query]);
  const results = workspaces
    .flatMap((workspace) =>
      workspace.boards.map((board) => ({
        ...board,
        workspace: workspace.name,
      })),
    )
    .filter((board) =>
      `${board.name} ${board.workspace}`
        .toLocaleLowerCase()
        .includes(query.trim().toLocaleLowerCase()),
    );
  const search = useInfiniteQuery({
    queryKey: ["principal", principalId, "task-search", term, archived],
    enabled: open && term.length >= 2,
    initialPageParam: null as string | null,
    queryFn: async ({ signal, pageParam }) => {
      const params = new URLSearchParams({
        q: term,
        archived: String(archived),
      });
      if (pageParam) params.set("cursor", pageParam);
      return taskSearchResultSchema.parse(
        (
          await apiRequest(`/api/v1/search/tasks?${params}`, {
            signal,
            cache: "no-store",
          })
        ).data,
      );
    },
    getNextPageParam: (last) => last.nextCursor,
    staleTime: 0,
    retry: false,
  });
  const tasks = search.data?.pages.flatMap((page) => page.tasks) ?? [];
  return (
    <>
      <Button
        variant="ghost"
        className="workspace-search-trigger"
        aria-label="Search workspace"
        aria-keyshortcuts="Control+K Meta+K"
        onClick={() => {
          setOpenMobile(false);
          setOpen(true);
        }}
      >
        <Search size={16} />
        <span>Search tasks and boards</span>
        <kbd className="workspace-search-key">Ctrl K</kbd>
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="workspace-search-panel pause-sheet">
          <PauseSheetDecor />
          <div className="pause-sheet-body flex flex-col">
            <div className="pr-5">
              <SheetTitle>Search your workspace</SheetTitle>
              <SheetDescription className="mt-2">
                Find tasks and boards across the workspaces you can access.
              </SheetDescription>
            </div>
            <Input
              aria-label="Search boards"
              maxLength={200}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search tasks, boards and workspaces…"
            />
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={archived}
                onChange={(event) => setArchived(event.target.checked)}
              />
              Search archived tasks
            </label>
            <div className="min-h-0 flex-1 space-y-6 overflow-y-auto pr-1">
              <section aria-label="Matching tasks" className="space-y-2">
                <header className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold">Tasks</h3>
                  {!search.isError && search.data && (
                    <span className="text-xs text-muted-foreground">
                      {search.data.pages[0].total.toLocaleString()} matches
                    </span>
                  )}
                </header>
                {term.length < 2 ? (
                  <p className="py-4 text-sm text-muted-foreground">
                    Type at least 2 characters to search tasks.
                  </p>
                ) : search.isError ? (
                  <PauseAlert intent="danger">
                    <p>{search.error.message}</p>
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-3"
                      onClick={() => void search.refetch()}
                    >
                      Try search again
                    </Button>
                  </PauseAlert>
                ) : search.isPending ? (
                  <p
                    role="status"
                    className="flex items-center gap-2 py-4 text-sm text-muted-foreground"
                  >
                    <LoaderCircle
                      size={16}
                      className="animate-spin motion-reduce:animate-none"
                    />
                    Searching tasks…
                  </p>
                ) : (
                  <>
                    {tasks.map((task) => (
                      <Link
                        key={task.id}
                        href={`/boards/${task.boardId}?task=${task.id}`}
                        onClick={() => setOpen(false)}
                        className="flex items-start gap-3 rounded-lg border bg-card p-4 hover:bg-secondary focus-visible:outline-2 focus-visible:outline-primary"
                      >
                        <CheckCheck
                          size={17}
                          className="mt-0.5 shrink-0 text-primary"
                        />
                        <div className="min-w-0">
                          <p className="break-words text-sm font-medium">
                            {task.name}
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {task.workspaceName} /{" "}
                            {task.projectName ? `${task.projectName} / ` : ""}
                            {task.boardName}
                            {task.recordName !== "Task"
                              ? ` · ${task.recordName}`
                              : ""}
                            {task.archived ? " / Archived" : ""}
                          </p>
                          {task.description && (
                            <p className="mt-2 line-clamp-2 break-words text-xs text-muted-foreground">
                              {task.description}
                            </p>
                          )}
                        </div>
                      </Link>
                    ))}
                    {!tasks.length && (
                      <div className="rounded-lg border border-dashed p-5 text-sm text-muted-foreground">
                        No matching {archived ? "archived " : ""}tasks. Try
                        another name or phrase.
                      </div>
                    )}
                    {search.hasNextPage && (
                      <Button
                        className="w-full"
                        variant="outline"
                        disabled={search.isFetchingNextPage}
                        onClick={() => void search.fetchNextPage()}
                      >
                        {search.isFetchingNextPage
                          ? "Loading tasks…"
                          : "Show more tasks"}
                      </Button>
                    )}
                  </>
                )}
              </section>
              <section
                aria-label="Matching boards"
                className="space-y-2 border-t pt-5"
              >
                <h3 className="text-sm font-semibold">
                  Boards{" "}
                  <span className="ml-1 font-normal text-muted-foreground">
                    {results.length}
                  </span>
                </h3>
                {results.slice(0, 20).map((board) => (
                  <Link
                    key={board.id}
                    href={`/boards/${board.id}`}
                    onClick={() => setOpen(false)}
                    className="flex items-center gap-3 rounded-lg border bg-card p-4 hover:bg-secondary"
                  >
                    <Columns3 size={18} className="shrink-0 text-primary" />
                    <div>
                      <p className="text-sm font-medium">{board.name}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {board.workspace}
                      </p>
                    </div>
                  </Link>
                ))}
                {results.length > 20 && (
                  <p className="text-xs text-muted-foreground">
                    Showing the first 20 boards. Keep typing to narrow the
                    results.
                  </p>
                )}
                {!results.length && (
                  <div className="rounded-lg border border-dashed p-5 text-sm text-muted-foreground">
                    <FolderOpen size={20} className="mb-3" />
                    No matching boards. Try another name.
                  </div>
                )}
              </section>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
