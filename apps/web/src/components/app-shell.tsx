"use client";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Building2,
  ChevronsUpDown,
  Check,
  Search,
  ContactRound,
  Home,
  Inbox,
  LayoutGrid,
  LogOut,
  Palette,
  Settings2,
  ShieldCheck,
  Users,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ModeSwitcher } from "@/components/appearance/theme-runtime";
import {
  WorkspaceSearch,
  WORKSPACE_SEARCH_EVENT,
  type NavigationWorkspace,
} from "@/components/workspace-search";
import { useSignOut } from "@/components/sign-out";
import { useNavigationLiveSync } from "@/components/projects/use-navigation-live-sync";
import { ProjectNavigation } from "@/components/projects/project-navigation";
import type { ProjectSummary } from "@/lib/project-contract";
import {
  NotificationBell,
  useUnreadCount,
} from "@/components/notifications/notification-inbox";
import { CRUMBS_SLOT } from "@/components/page-crumbs";

const navigation = [
  { href: "/", label: "Overview", icon: Home },
  { href: "/boards", label: "Boards", icon: LayoutGrid },
  { href: "/approvals", label: "Approvals", icon: ShieldCheck },
  { href: "/notifications", label: "Inbox", icon: Inbox },
] as const;
const roleLabel = (role?: string) =>
  role === "OWNER"
    ? "Owner"
    : role === "ADMIN"
      ? "Administrator"
      : "Team member";
const initials = (name?: string) =>
  (name ?? "Y")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");

function AccountMenu({
  name,
  role,
  compact = false,
}: {
  name?: string;
  role?: string;
  compact?: boolean;
}) {
  const signOut = useSignOut();
  const { setOpenMobile } = useSidebar();
  const admin = role === "OWNER" || role === "ADMIN";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <SidebarMenuButton
          size="lg"
          aria-label={`Account menu for ${name ?? "you"}`}
          className={
            compact ? "shell-account shell-account-compact" : "shell-account"
          }
        >
          <span className="shell-avatar" aria-hidden="true">
            {initials(name)}
          </span>
          {!compact && (
            <span className="grid min-w-0 flex-1 text-left leading-tight">
              <span className="truncate text-sm font-semibold">{name}</span>
              <span className="truncate text-xs text-sidebar-foreground/65">
                {roleLabel(role)}
              </span>
            </span>
          )}
          {!compact && <ChevronsUpDown size={15} className="opacity-60" />}
        </SidebarMenuButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" className="w-56">
        <DropdownMenuItem asChild>
          <Link href="/settings" onClick={() => setOpenMobile(false)}>
            <Settings2 /> Settings
          </Link>
        </DropdownMenuItem>
        {admin && (
          <>
            <DropdownMenuItem asChild>
              <Link href="/settings/team" onClick={() => setOpenMobile(false)}>
                <Users /> Team access
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link
                href="/settings/appearance"
                onClick={() => setOpenMobile(false)}
              >
                <Palette /> Appearance
              </Link>
            </DropdownMenuItem>
          </>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          disabled={signOut.isPending}
          onSelect={() => signOut.mutate()}
        >
          <LogOut /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function WorkspaceSidebar({
  installationName = "Yuzu",
  workspaceName = "Your team's space",
  workspaces,
  projects,
  creatableWorkspaces,
  role,
  ownerName,
  principalId,
  approvalCount,
}: {
  installationName?: string;
  workspaceName?: string;
  workspaces: NavigationWorkspace[];
  projects: ProjectSummary[];
  creatableWorkspaces: { id: string; name: string }[];
  role?: string;
  ownerName?: string;
  principalId: string;
  approvalCount: number;
}) {
  const pathname = usePathname();
  const isCrm = pathname === "/crm" || pathname.startsWith("/crm/");
  const moduleNavigation = isCrm
    ? [
        { href: "/crm", label: "CRM overview", icon: Home },
        { href: "/crm/companies", label: "Companies", icon: Building2 },
        { href: "/crm/contacts", label: "Contacts", icon: ContactRound },
        ...navigation.filter(
          (item) =>
            item.href === "/approvals" || item.href === "/notifications",
        ),
      ]
    : navigation;
  const { isMobile, setOpenMobile } = useSidebar();
  const close = () => setOpenMobile(false);
  const unread = useUnreadCount(principalId);
  const counts: Record<string, number> = {
    "/approvals": approvalCount,
    "/notifications": unread,
  };
  const activeWorkspace = workspaces.find(
    (item) =>
      item.boards.some((board) => pathname === `/boards/${board.id}`) ||
      projects.some(
        (project) =>
          project.workspaceId === item.id &&
          pathname === `/projects/${project.id}`,
      ),
  );
  const workspaceLabel = activeWorkspace?.name ?? workspaceName;
  // Overview links match only themselves; sections match their pages too.
  const active = (href: string) =>
    pathname === href ||
    (href !== "/" && href !== "/crm" && pathname.startsWith(`${href}/`));
  return (
    <Sidebar
      collapsible="icon"
      className="shell-sidebar"
      aria-label={`${installationName} navigation`}
    >
      <div className="shell-navigation-columns">
        <div className="shell-module-rail">
          <Link
            href="/"
            onClick={close}
            aria-label="Yuzu overview"
            className="shell-rail-brand"
          >
            <Image src="/logo.svg" alt="" width={27} height={27} priority />
          </Link>
          <nav aria-label="Modules" className="shell-rail-modules">
            {[
              { href: "/", label: "Work", icon: LayoutGrid, selected: !isCrm },
              { href: "/crm", label: "CRM", icon: Users, selected: isCrm },
            ].map(({ href, label, icon: Icon, selected }) => (
              <Link
                key={href}
                href={href}
                onClick={close}
                aria-current={selected ? "page" : undefined}
                className="shell-rail-module"
                title={`${label} module`}
              >
                <Icon size={18} aria-hidden="true" />
                <span>{label}</span>
              </Link>
            ))}
          </nav>
          <div className="shell-rail-identity" aria-hidden="true">
            {initials(ownerName)}
          </div>
          <div className="shell-rail-account">
            <AccountMenu name={ownerName} role={role} compact />
          </div>
        </div>
        <div className="shell-context-panel">
          <SidebarHeader className="shell-context-header">
            <div className="flex min-w-0 items-center gap-1">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="shell-workspace shell-module-picker"
                    aria-label={`Switch module, current module ${isCrm ? "CRM" : "Work"}`}
                  >
                    <span className="shell-workspace-mark" aria-hidden="true">
                      {workspaceLabel.charAt(0).toUpperCase()}
                    </span>
                    <span className="grid min-w-0 flex-1 text-left leading-tight">
                      <span className="truncate text-sm font-semibold">
                        {workspaceLabel}
                      </span>
                      <span className="truncate text-xs text-sidebar-foreground/65">
                        {isCrm ? "CRM" : "Work"}
                      </span>
                    </span>
                    <ChevronsUpDown size={14} aria-hidden="true" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="start"
                  className="shell-module-menu"
                >
                  <div className="px-2 py-1 text-xs font-medium text-muted-foreground">
                    Modules
                  </div>
                  {[
                    {
                      href: "/",
                      label: "Work",
                      description: "Projects and tasks",
                      icon: LayoutGrid,
                      selected: !isCrm,
                    },
                    {
                      href: "/crm",
                      label: "CRM",
                      description: "Customers and sales",
                      icon: Users,
                      selected: isCrm,
                    },
                  ].map(
                    ({ href, label, description, icon: Icon, selected }) => (
                      <DropdownMenuItem key={href} asChild>
                        <Link
                          href={href}
                          onClick={close}
                          data-active={selected || undefined}
                        >
                          <Icon size={17} aria-hidden="true" />
                          <span className="flex-1">
                            <span className="block font-semibold">{label}</span>
                            <span className="block text-xs text-muted-foreground">
                              {description}
                            </span>
                          </span>
                          {selected && <Check size={15} aria-hidden="true" />}
                        </Link>
                      </DropdownMenuItem>
                    ),
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
              {isMobile && (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Close navigation"
                  onClick={close}
                >
                  <X size={16} />
                </Button>
              )}
            </div>
            <button
              type="button"
              className="shell-context-search"
              aria-label="Search workspace"
              aria-keyshortcuts="Control+K Meta+K"
              onClick={() =>
                window.dispatchEvent(new Event(WORKSPACE_SEARCH_EVENT))
              }
            >
              <Search size={15} aria-hidden="true" />
              <span>Search</span>
              <kbd>Ctrl K</kbd>
            </button>
          </SidebarHeader>
          <SidebarContent className="gap-1">
            <SidebarGroup>
              <SidebarGroupContent>
                <nav aria-label="Main navigation">
                  <SidebarMenu>
                    {moduleNavigation.map(({ href, label, icon: Icon }) => (
                      <SidebarMenuItem key={href}>
                        <SidebarMenuButton
                          asChild
                          isActive={active(href)}
                          tooltip={label}
                          className="h-9"
                        >
                          <Link
                            href={href}
                            onClick={close}
                            aria-current={active(href) ? "page" : undefined}
                          >
                            <Icon size={17} />
                            <span>{label}</span>
                          </Link>
                        </SidebarMenuButton>
                        {(counts[href] ?? 0) > 0 && (
                          <SidebarMenuBadge
                            className="shell-badge"
                            aria-label={`${counts[href]} ${href === "/approvals" ? "waiting on you" : "unread"}`}
                          >
                            {counts[href] > 99 ? "99+" : counts[href]}
                          </SidebarMenuBadge>
                        )}
                      </SidebarMenuItem>
                    ))}
                  </SidebarMenu>
                </nav>
              </SidebarGroupContent>
            </SidebarGroup>
            {!isCrm && (
              <ProjectNavigation
                projects={projects}
                workspaces={workspaces}
                creatableWorkspaces={creatableWorkspaces}
                isAdmin={role === "OWNER" || role === "ADMIN"}
              />
            )}
          </SidebarContent>
          <SidebarFooter className="shell-context-footer">
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  asChild
                  isActive={active("/settings")}
                  tooltip="Settings"
                  className="h-9"
                >
                  <Link
                    href="/settings"
                    onClick={close}
                    aria-current={active("/settings") ? "page" : undefined}
                  >
                    <Settings2 size={17} />
                    <span>Settings</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <AccountMenu name={ownerName} role={role} />
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarFooter>
        </div>
      </div>
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
  approvalCount = 0,
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
  /** Pending approval requests from other people on visible boards. */
  approvalCount?: number;
  role?: string;
}) {
  useNavigationLiveSync(principalId);
  return (
    <SidebarProvider
      defaultOpen={sidebarDefaultOpen}
      className="yuzu-workspace"
      style={
        {
          "--sidebar-width": "20rem",
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
        ownerName={ownerName}
        principalId={principalId}
        approvalCount={approvalCount}
      />
      <SidebarInset className="shell-inset">
        <div className="shell-panel">
          <header className="shell-topbar yuzu-topbar">
            <SidebarTrigger aria-label="Toggle navigation" />
            <div id={CRUMBS_SLOT} className="shell-crumbs" />
            <div className="shell-actions">
              <WorkspaceSearch principalId={principalId} />
              <ModeSwitcher />
              <NotificationBell principalId={principalId} />
            </div>
          </header>
          <main
            id="main-content"
            tabIndex={-1}
            className="workspace-content shell-main outline-none"
          >
            {children}
          </main>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
