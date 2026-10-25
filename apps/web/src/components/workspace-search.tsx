"use client";
import { useState, useEffect, useRef } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useRouter } from "nextjs-toploader/app";
import {
  Search,
  Columns3,
  FolderOpen,
  CheckCheck,
  LoaderCircle,
  LayoutGrid,
  Users,
  Settings2,
  Inbox,
  ShieldCheck,
} from "lucide-react";
import { useSidebar } from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";
import { PauseLeaf, PauseSlice } from "@/components/pause/decor";
import { apiRequest } from "@/lib/api-client";
import { taskSearchResultSchema } from "@/lib/task-search-contract";
import { navigationSearchResultSchema } from "@/lib/navigation-search-contract";
export const WORKSPACE_SEARCH_EVENT = "yuzu:open-workspace-search";

export type NavigationWorkspace = {
  id: string;
  name: string;
  boards: { id: string; name: string; projectId?: string | null }[];
};
function useNavigationSearch(
  kind: "board" | "project",
  principalId: string,
  q: string,
  archived: boolean,
  enabled: boolean,
) {
  return useInfiniteQuery({
    queryKey: [
      "principal",
      principalId,
      "task-search",
      "navigation",
      kind,
      q,
      archived,
    ],
    enabled,
    initialPageParam: null as string | null,
    queryFn: async ({ signal, pageParam }) => {
      const params = new URLSearchParams({
        kind,
        q,
        archived: String(archived),
      });
      if (pageParam) params.set("cursor", pageParam);
      return navigationSearchResultSchema.parse(
        (
          await apiRequest(`/api/v1/search/navigation?${params}`, {
            signal,
            cache: "no-store",
          })
        ).data,
      );
    },
    getNextPageParam: (last) => last.nextCursor,
    staleTime: 0,
    retry: false,
    refetchInterval: enabled ? 30_000 : false,
  });
}

export function WorkspaceSearch({ principalId }: { principalId: string }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const { setOpenMobile } = useSidebar();
  const [query, setQuery] = useState("");
  const [archived, setArchived] = useState(false);
  const [term, setTerm] = useState("");
  // Ctrl+K (or Cmd+K) opens search from anywhere in the workspace.
  useEffect(() => {
    const openSearch = () => {
      returnFocus.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
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
  const settled = query.trim() === term;
  const tasks = settled
    ? (search.data?.pages.flatMap((page) => page.tasks) ?? [])
    : [];
  const waiting = query.trim().length >= 2 && (!settled || search.isPending);
  const matches = (text: string) =>
    text.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
  const boardSearch = useNavigationSearch(
    "board",
    principalId,
    term,
    archived,
    open && settled,
  );
  const projectSearch = useNavigationSearch(
    "project",
    principalId,
    term,
    archived,
    open && settled,
  );
  const shortcuts = [
    { label: "Work overview", href: "/", icon: LayoutGrid },
    { label: "CRM overview", href: "/crm", icon: Users },
    { label: "Approvals", href: "/approvals", icon: ShieldCheck },
    { label: "Inbox", href: "/notifications", icon: Inbox },
    { label: "Settings", href: "/settings", icon: Settings2 },
  ].filter((item) => matches(item.label));
  const navigate = (href: string) => {
    setOpen(false);
    router.push(href);
  };
  return (
    <>
      <Button
        ref={triggerRef}
        variant="ghost"
        className="workspace-search-trigger"
        aria-label="Search workspace"
        aria-keyshortcuts="Control+K Meta+K"
        onClick={() => {
          returnFocus.current =
            document.activeElement instanceof HTMLElement
              ? document.activeElement
              : null;
          setOpenMobile(false);
          setOpen(true);
        }}
      >
        <Search size={16} />
        <span>Search tasks and boards</span>
        <kbd className="workspace-search-key">Ctrl K</kbd>
      </Button>
      <CommandDialog
        open={open}
        onOpenChange={setOpen}
        title="Search your workspace"
        inputLabel="Search workspace records"
        description="Find a task, jump to a board, or go somewhere new."
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          const prior = returnFocus.current;
          if (prior?.isConnected && prior.getClientRects().length)
            prior.focus();
          else {
            const sidebarSearch = document.querySelector<HTMLButtonElement>(
              ".shell-context-search",
            );
            if (sidebarSearch?.getClientRects().length) sidebarSearch.focus();
            else triggerRef.current?.focus();
          }
        }}
        decoration={
          <>
            <PauseLeaf className="pause-leaf command-leaf" />
            <span className="pause-clip" aria-hidden="true">
              <PauseSlice className="pause-slice command-lemon" />
            </span>
          </>
        }
      >
        <CommandInput
          aria-label="Search workspace records"
          placeholder="Search tasks, boards, projects…"
          maxLength={200}
          value={query}
          onValueChange={setQuery}
        />
        <div
          className="command-controls"
          onKeyDown={(event) => {
            if (event.key === "Enter") event.stopPropagation();
          }}
        >
          <label>
            <input
              type="checkbox"
              checked={archived}
              onChange={(event) => setArchived(event.target.checked)}
            />
            Search archived
          </label>
          <span>Only what you can access</span>
        </div>
        <CommandList aria-label="Search results">
          {shortcuts.length > 0 && (
            <CommandGroup heading="Go to">
              {shortcuts.map(({ label, href, icon: Icon }) => (
                <CommandItem
                  key={href}
                  value={`shortcut:${href}`}
                  onSelect={() => navigate(href)}
                >
                  <Icon size={17} aria-hidden="true" />
                  <span>{label}</span>
                  <span className="command-item-hint">Open</span>
                </CommandItem>
              ))}
            </CommandGroup>
          )}
          <section
            aria-label="Matching tasks"
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                event.target instanceof HTMLButtonElement
              )
                event.stopPropagation();
            }}
          >
            <CommandGroup
              heading={
                settled && search.data && term.length >= 2
                  ? `Tasks · ${search.data.pages[0].total.toLocaleString()} matches`
                  : "Tasks"
              }
            >
              {query.trim().length < 2 ? (
                <p className="command-message">
                  Type at least 2 characters to search tasks.
                </p>
              ) : waiting ? (
                <p className="command-message" role="status">
                  <LoaderCircle
                    size={16}
                    className="animate-spin motion-reduce:animate-none"
                  />
                  Searching tasks…
                </p>
              ) : search.isError ? (
                <div className="command-message" role="alert">
                  <p>{search.error.message}</p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void search.refetch()}
                  >
                    Try search again
                  </Button>
                </div>
              ) : (
                <>
                  {tasks.map((task) => (
                    <CommandItem
                      key={task.id}
                      value={`task:${task.id}`}
                      data-href={`/boards/${task.boardId}?task=${task.id}`}
                      onSelect={() =>
                        navigate(`/boards/${task.boardId}?task=${task.id}`)
                      }
                    >
                      <CheckCheck size={17} aria-hidden="true" />
                      <div className="command-result-copy">
                        <p>{task.name}</p>
                        <small>
                          {task.workspaceName} /{" "}
                          {task.projectName ? `${task.projectName} / ` : ""}
                          {task.boardName}
                          {task.recordName !== "Task"
                            ? ` · ${task.recordName}`
                            : ""}
                          {task.parentName ? ` / ${task.parentName}` : ""}
                          {task.archived ? " / Archived" : ""}
                        </small>
                        {task.description && (
                          <small className="line-clamp-1">
                            {task.description}
                          </small>
                        )}
                      </div>
                    </CommandItem>
                  ))}
                  {!tasks.length && (
                    <p className="command-message">
                      No matching tasks. Try another name or phrase.
                    </p>
                  )}
                </>
              )}
            </CommandGroup>
            {settled && search.hasNextPage && (
              <Button
                className="command-more"
                size="sm"
                variant="ghost"
                disabled={search.isFetchingNextPage}
                onClick={() => void search.fetchNextPage()}
              >
                {search.isFetchingNextPage
                  ? "Loading tasks…"
                  : "Show more tasks"}
              </Button>
            )}
          </section>
          {(
            [
              ["project", projectSearch, FolderOpen],
              ["board", boardSearch, Columns3],
            ] as const
          ).map(([kind, resource, Icon]) => {
            const label = kind === "project" ? "projects" : "boards";
            const items = settled
              ? (resource.data?.pages.flatMap((page) => page.items) ?? [])
              : [];
            return (
              <section
                key={kind}
                aria-label={`Matching ${label}`}
                onKeyDown={(event) => {
                  if (
                    event.key === "Enter" &&
                    event.target instanceof HTMLButtonElement
                  )
                    event.stopPropagation();
                }}
              >
                <CommandGroup
                  heading={kind === "project" ? "Projects" : "Boards"}
                >
                  {!settled || resource.isPending ? (
                    <p className="command-message" role="status">
                      Searching {label}…
                    </p>
                  ) : resource.isError ? (
                    <div className="command-message" role="alert">
                      <p>{resource.error.message}</p>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void resource.refetch()}
                      >
                        Retry {label}
                      </Button>
                    </div>
                  ) : (
                    <>
                      {items.map((item) => (
                        <CommandItem
                          key={item.id}
                          value={`${kind}:${item.id}`}
                          onSelect={() =>
                            navigate(
                              `/${kind === "project" ? "projects" : "boards"}/${item.id}`,
                            )
                          }
                        >
                          <Icon size={17} aria-hidden="true" />
                          <div className="command-result-copy">
                            <p>{item.name}</p>
                            <small>
                              {item.workspaceName}
                              {item.projectName ? ` / ${item.projectName}` : ""}
                            </small>
                          </div>
                          {item.archived && (
                            <span className="command-item-hint">
                              {kind === "board" &&
                              item.archiveSource === "project"
                                ? "Archived project"
                                : "Archived"}
                            </span>
                          )}
                        </CommandItem>
                      ))}
                      {!items.length && (
                        <p className="command-message">
                          No matching {archived ? "archived " : ""}
                          {label}.
                        </p>
                      )}
                    </>
                  )}
                </CommandGroup>
                {settled && resource.hasNextPage && (
                  <Button
                    className="command-more"
                    size="sm"
                    variant="ghost"
                    disabled={resource.isFetchingNextPage}
                    onClick={() => void resource.fetchNextPage()}
                  >
                    {resource.isFetchingNextPage
                      ? `Loading ${label}…`
                      : `Show more ${label}`}
                  </Button>
                )}
              </section>
            );
          })}
        </CommandList>
        <footer className="command-footer">
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd> Navigate
          </span>
          <span>
            <kbd>↵</kbd> Open
          </span>
          <span className="ml-auto">
            <kbd>Esc</kbd> Close
          </span>
        </footer>
      </CommandDialog>
    </>
  );
}
