"use client";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CheckCheck,
  FolderOpen,
  Palette,
  Home,
  LayoutGrid,
  Settings2,
  Sprout,
  X,
  Inbox,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { ModeSwitcher } from "@/components/appearance/theme-runtime";
import {
  WorkspaceSearch,
  type NavigationWorkspace,
} from "@/components/workspace-search";
import { SignOut } from "@/components/sign-out";
import { ProjectNavigation } from "@/components/projects/project-navigation";
import type { ProjectSummary } from "@/lib/project-contract";
import { NotificationBell } from "@/components/notifications/notification-inbox";

const navigation = [
  { href: "/", label: "Overview", icon: Home },
  { href: "/boards", label: "Boards", icon: LayoutGrid },
  { href: "/approvals", label: "Approvals", icon: CheckCheck },
  { href: "/notifications", label: "Inbox", icon: Inbox },
  { href: "/settings", label: "Settings", icon: Settings2 },
];
function WorkspaceSidebar({
  installationName = "Yuzu",
  workspaceName = "Your team's space",
  workspaces,
  projects,
  creatableWorkspaces,
  role,
}: {
  installationName?: string;
  workspaceName?: string;
  workspaces: NavigationWorkspace[];
  projects: ProjectSummary[];
  creatableWorkspaces: { id: string; name: string }[];
  role?: string;
}) {
  const pathname = usePathname();
  const { isMobile, setOpenMobile } = useSidebar();
  const close = () => setOpenMobile(false);
  const activeWorkspace = workspaces.find(
    (item) =>
      item.boards.some((board) => pathname === `/boards/${board.id}`) ||
      projects.some(
        (project) =>
          project.workspaceId === item.id &&
          pathname === `/projects/${project.id}`,
      ),
  );
  return (
    <Sidebar collapsible="icon" className="border-sidebar-border">
      <SidebarHeader className="gap-5 p-4 group-data-[collapsible=icon]:p-2">
        <div className="flex items-center justify-between">
          <Link
            href="/"
            onClick={close}
            aria-label="Yuzu overview"
            className="flex min-w-0 items-center gap-3 rounded-lg"
          >
            <Image
              src="/logo.svg"
              alt=""
              width={32}
              height={32}
              priority
              className="shrink-0"
            />
            <span className="text-2xl font-semibold tracking-tight group-data-[collapsible=icon]:hidden">
              yuzu.
            </span>
          </Link>
          {isMobile && (
            <Button
              variant="ghost"
              size="icon"
              aria-label="Close navigation"
              onClick={close}
            >
              <X size={18} />
            </Button>
          )}
        </div>
        <div className="workspace-identity group-data-[collapsible=icon]:hidden">
          <span className="workspace-identity-icon">
            <FolderOpen size={18} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{installationName}</p>
            <p className="mt-0.5 truncate text-xs text-sidebar-foreground/70">
              {activeWorkspace?.name ?? workspaceName}
            </p>
          </div>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="text-sidebar-foreground/65">
            Your workspace
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <nav aria-label="Main navigation">
              <SidebarMenu>
                {navigation.map(({ href, label, icon: Icon }) => {
                  const active =
                    pathname === href ||
                    (href !== "/" && pathname.startsWith(`${href}/`));
                  return (
                    <SidebarMenuItem key={href}>
                      <SidebarMenuButton
                        asChild
                        isActive={active}
                        tooltip={label}
                        className="h-9"
                      >
                        <Link
                          href={href}
                          onClick={close}
                          aria-current={active ? "page" : undefined}
                        >
                          <Icon size={18} />
                          <span>{label}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </nav>
          </SidebarGroupContent>
        </SidebarGroup>
        <ProjectNavigation
          projects={projects}
          workspaces={workspaces}
          creatableWorkspaces={creatableWorkspaces}
          isAdmin={role === "OWNER" || role === "ADMIN"}
        />
        {(role === "OWNER" || role === "ADMIN") && (
          <SidebarGroup>
            <SidebarGroupLabel className="text-sidebar-foreground/65">
              Administration
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    tooltip="Appearance"
                    isActive={pathname === "/settings/appearance"}
                  >
                    <Link href="/settings/appearance" onClick={close}>
                      <Palette size={16} />
                      <span>Appearance</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>
      <SidebarFooter className="p-4 group-data-[collapsible=icon]:p-2">
        <div className="rounded-xl bg-sidebar-accent p-4 group-data-[collapsible=icon]:hidden">
          <Sprout size={20} className="mb-3 text-sidebar-foreground/80" />
          <p className="text-sm font-medium">Room to grow.</p>
          <p className="mt-2 text-xs leading-relaxed text-sidebar-foreground/75">
            A workspace shaped around your team, one project at a time.
          </p>
        </div>
        <p className="mt-2 truncate text-xs text-sidebar-foreground/65 group-data-[collapsible=icon]:hidden">
          {installationName}
        </p>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
export function AppShell({
  principalId,
  children,
  installationName,
  workspaceName,
  ownerName,
  sidebarDefaultOpen = true,
  workspaces = [],
  projects = [],
  creatableWorkspaces = [],
  role,
}: {
  principalId: string;
  children: React.ReactNode;
  installationName?: string;
  workspaceName?: string;
  ownerName?: string;
  sidebarDefaultOpen?: boolean;
  workspaces?: NavigationWorkspace[];
  projects?: ProjectSummary[];
  creatableWorkspaces?: { id: string; name: string }[];
  role?: string;
}) {
  const pathname = usePathname();
  const title =
    navigation.find(
      (item) =>
        item.href === pathname ||
        (item.href !== "/" && pathname.startsWith(`${item.href}/`)),
    )?.label ?? "Workspace";
  return (
    <SidebarProvider
      defaultOpen={sidebarDefaultOpen}
      className="yuzu-workspace"
      style={
        {
          "--sidebar-width": "16rem",
          "--sidebar-width-icon": "3.5rem",
        } as React.CSSProperties
      }
    >
      <a
        href="#main-content"
        className="sr-only z-50 rounded bg-card p-3 text-primary focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>
      <WorkspaceSidebar
        installationName={installationName}
        workspaceName={workspaceName}
        workspaces={workspaces}
        projects={projects}
        creatableWorkspaces={creatableWorkspaces}
        role={role}
      />
      <SidebarInset className="min-w-0 bg-transparent">
        <header className="yuzu-topbar sticky top-0 z-20 flex h-16 items-center justify-between gap-3 border-b px-4 sm:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <SidebarTrigger aria-label="Toggle navigation" />
            <WorkspaceSearch
              workspaces={workspaces}
              principalId={principalId}
            />
            <span className="sr-only">{title}</span>
          </div>
          <div className="flex shrink-0 items-center gap-2 sm:gap-4">
            <ModeSwitcher />
            <NotificationBell principalId={principalId} />
            <SignOut />
            <div
              aria-label="Yuzu workspace"
              className="hidden size-9 items-center justify-center rounded-full bg-secondary text-sm font-semibold text-primary sm:flex"
            >
              {ownerName?.charAt(0).toUpperCase() ?? "Y"}
            </div>
            <div className="hidden min-w-0 lg:block">
              <p className="max-w-40 truncate text-xs font-medium">
                {ownerName}
              </p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                {role === "OWNER"
                  ? "Workspace owner"
                  : role === "ADMIN"
                    ? "Administrator"
                    : "Team member"}
              </p>
            </div>
          </div>
        </header>
        <main
          id="main-content"
          tabIndex={-1}
          className="workspace-content mx-auto w-full max-w-[1600px] px-5 py-6 outline-none sm:px-7"
        >
          {children}
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
