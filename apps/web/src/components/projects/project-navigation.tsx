"use client";
import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Collapsible } from "radix-ui";
import {
  Archive,
  ArrowDown,
  ArrowUp,
  ChevronRight,
  Columns3,
  Lock,
  MoreHorizontal,
  Pencil,
  Plus,
  Users,
} from "lucide-react";
import {
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ProjectSummary } from "@/lib/project-contract";
import type { NavigationWorkspace } from "@/components/workspace-search";
import { ProjectBadge } from "./project-badge";
import { CreateProjectSheet } from "./create-project";
import { ArchiveProjectDialog } from "./archive-project";
import { useProjectAction } from "./use-project-action";

export function ProjectNavigation({
  projects,
  workspaces,
  creatableWorkspaces,
  isAdmin,
}: {
  projects: ProjectSummary[];
  workspaces: NavigationWorkspace[];
  creatableWorkspaces: { id: string; name: string }[];
  isAdmin: boolean;
}) {
  const pathname = usePathname();
  const { setOpenMobile } = useSidebar();
  const close = () => setOpenMobile(false);
  const [creating, setCreating] = useState(false);
  const [archiving, setArchiving] = useState<ProjectSummary | null>(null);
  const reorder = useProjectAction("reorder");
  const multiple = workspaces.length > 1;
  const workspaceName = (id: string) =>
    workspaces.find((item) => item.id === id)?.name;
  const move = (project: ProjectSummary, offset: -1 | 1) => {
    const ids = projects
      .filter((item) => item.workspaceId === project.workspaceId)
      .map((item) => item.id);
    const from = ids.indexOf(project.id);
    const to = from + offset;
    if (to < 0 || to >= ids.length) return;
    [ids[from], ids[to]] = [ids[to], ids[from]];
    reorder.mutate({ workspaceId: project.workspaceId, projectIds: ids });
  };
  const standalone = workspaces
    .map((workspace) => ({
      ...workspace,
      boards: workspace.boards.filter((board) => !board.projectId),
    }))
    .filter((workspace) => workspace.boards.length > 0);
  return (
    <>
      <SidebarGroup>
        <SidebarGroupLabel className="text-sidebar-foreground/65">
          Projects
        </SidebarGroupLabel>
        {creatableWorkspaces.length > 0 && (
          <SidebarGroupAction
            title="New project"
            aria-label="New project"
            onClick={() => setCreating(true)}
          >
            <Plus />
          </SidebarGroupAction>
        )}
        <SidebarGroupContent>
          <nav aria-label="Projects">
            <SidebarMenu>
              {projects.length === 0 && (
                <p className="px-2 py-1.5 text-xs text-sidebar-foreground/65 group-data-[collapsible=icon]:hidden">
                  No projects yet.
                </p>
              )}
              {projects.map((project, index) => {
                const href = `/projects/${project.id}`;
                const inside = project.boards.some(
                  (board) => pathname === `/boards/${board.id}`,
                );
                const siblings = projects.filter(
                  (item) => item.workspaceId === project.workspaceId,
                );
                const place = siblings.indexOf(project);
                return (
                  <Collapsible.Root
                    key={project.id}
                    asChild
                    defaultOpen={inside || pathname === href || index < 3}
                    className="group/project"
                  >
                    <SidebarMenuItem>
                      <SidebarMenuButton
                        asChild
                        tooltip={project.name}
                        isActive={pathname === href}
                        className="h-9 pr-14"
                      >
                        <Link
                          href={href}
                          onClick={close}
                          aria-current={pathname === href ? "page" : undefined}
                        >
                          <ProjectBadge
                            name={project.name}
                            color={project.color}
                          />
                          <span className="truncate">{project.name}</span>
                          {multiple && (
                            <span className="sr-only">
                              , in {workspaceName(project.workspaceId)}
                            </span>
                          )}
                          {project.visibility === "PRIVATE" && (
                            <Lock
                              size={12}
                              aria-label="Private project"
                              className="ml-auto shrink-0 opacity-70"
                            />
                          )}
                        </Link>
                      </SidebarMenuButton>
                      <Collapsible.Trigger asChild>
                        <SidebarMenuAction
                          className="right-7 transition-transform group-data-[state=open]/project:rotate-90"
                          aria-label={`Show boards in ${project.name}`}
                        >
                          <ChevronRight />
                        </SidebarMenuAction>
                      </Collapsible.Trigger>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <SidebarMenuAction
                            showOnHover
                            aria-label={`${project.name} options`}
                          >
                            <MoreHorizontal />
                          </SidebarMenuAction>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent side="right" align="start">
                          <DropdownMenuItem asChild>
                            <Link
                              href={`${href}?panel=members`}
                              onClick={close}
                            >
                              <Users /> Members
                            </Link>
                          </DropdownMenuItem>
                          {project.canManage && (
                            <DropdownMenuItem asChild>
                              <Link href={`${href}?panel=edit`} onClick={close}>
                                <Pencil /> Rename, color and privacy
                              </Link>
                            </DropdownMenuItem>
                          )}
                          {isAdmin && siblings.length > 1 && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                disabled={place === 0 || reorder.isPending}
                                onSelect={() => move(project, -1)}
                              >
                                <ArrowUp /> Move up
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                disabled={
                                  place === siblings.length - 1 ||
                                  reorder.isPending
                                }
                                onSelect={() => move(project, 1)}
                              >
                                <ArrowDown /> Move down
                              </DropdownMenuItem>
                            </>
                          )}
                          {project.canManage && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                destructive
                                onSelect={() => setArchiving(project)}
                              >
                                <Archive /> Archive
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                      <Collapsible.Content>
                        <SidebarMenuSub>
                          {project.boards.length === 0 && (
                            <li className="px-2 py-1 text-xs text-sidebar-foreground/60">
                              No boards yet
                            </li>
                          )}
                          {project.boards.map((board) => {
                            const boardHref = `/boards/${board.id}`;
                            return (
                              <SidebarMenuSubItem key={board.id}>
                                <SidebarMenuSubButton
                                  asChild
                                  isActive={pathname === boardHref}
                                >
                                  <Link
                                    href={boardHref}
                                    onClick={close}
                                    aria-current={
                                      pathname === boardHref
                                        ? "page"
                                        : undefined
                                    }
                                  >
                                    <span className="truncate">
                                      {board.name}
                                    </span>
                                  </Link>
                                </SidebarMenuSubButton>
                              </SidebarMenuSubItem>
                            );
                          })}
                        </SidebarMenuSub>
                      </Collapsible.Content>
                    </SidebarMenuItem>
                  </Collapsible.Root>
                );
              })}
            </SidebarMenu>
          </nav>
        </SidebarGroupContent>
      </SidebarGroup>
      <SidebarGroup>
        <SidebarGroupLabel className="text-sidebar-foreground/65">
          Boards
        </SidebarGroupLabel>
        <SidebarGroupContent>
          <nav aria-label="Workspace boards">
            <SidebarMenu>
              {standalone.length === 0 && (
                <p className="px-2 py-1.5 text-xs text-sidebar-foreground/65 group-data-[collapsible=icon]:hidden">
                  Boards outside a project appear here.
                </p>
              )}
              {standalone.map((workspace) => (
                <SidebarMenuItem key={workspace.id}>
                  {multiple && (
                    <div className="workspace-nav-label group-data-[collapsible=icon]:hidden">
                      {workspace.name}
                    </div>
                  )}
                  {workspace.boards.map((board) => {
                    const boardHref = `/boards/${board.id}`;
                    return (
                      <SidebarMenuButton
                        key={board.id}
                        asChild
                        tooltip={board.name}
                        isActive={pathname === boardHref}
                        className="h-9"
                      >
                        <Link
                          href={boardHref}
                          onClick={close}
                          aria-current={
                            pathname === boardHref ? "page" : undefined
                          }
                        >
                          <Columns3 size={16} />
                          <span>{board.name}</span>
                        </Link>
                      </SidebarMenuButton>
                    );
                  })}
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </nav>
        </SidebarGroupContent>
      </SidebarGroup>
      <CreateProjectSheet
        open={creating}
        onOpenChange={setCreating}
        workspaces={creatableWorkspaces}
      />
      <ArchiveProjectDialog
        project={archiving}
        onOpenChange={(open) => !open && setArchiving(null)}
      />
    </>
  );
}
