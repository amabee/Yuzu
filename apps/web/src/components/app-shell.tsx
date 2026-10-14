"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CheckCheck,
  ChevronRight,
  CircleHelp,
  Home,
  LayoutGrid,
  Menu,
  Settings2,
  Sprout,
} from "lucide-react";
import { useUiStore } from "@/components/providers";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { ModeSwitcher } from "@/components/appearance/theme-runtime";
import { SignOut } from "@/components/sign-out";

const navigation = [
  { href: "/", label: "Overview", icon: Home },
  { href: "/boards", label: "Boards", icon: LayoutGrid },
  { href: "/approvals", label: "Approvals", icon: CheckCheck },
  { href: "/settings", label: "Settings", icon: Settings2 },
];

function Sidebar({
  close,
  installationName = "Yuzu",
  workspaceName = "Your team's space",
}: {
  close?: () => void;
  installationName?: string;
  workspaceName?: string;
}) {
  const pathname = usePathname();
  return (
    <div className="flex h-full flex-col bg-sidebar px-5 py-7 text-sidebar-foreground">
      <Link
        href="/"
        onClick={close}
        aria-label="Yuzu overview"
        className="mb-10 flex w-fit items-center gap-3 rounded-lg"
      >
        <Image src="/logo.svg" alt="" width={36} height={36} priority />
        <span className="text-2xl font-semibold tracking-tight">
          yuzu<span className="text-brand-highlight">.</span>
        </span>
      </Link>
      <div className="mb-7 rounded-xl border border-sidebar-foreground/15 bg-sidebar-foreground/8 px-3 py-3">
        <p className="text-[10px] font-semibold tracking-[0.14em] text-sidebar-foreground/65 uppercase">
          Workspace
        </p>
        <p className="mt-1 truncate text-sm font-medium">{workspaceName}</p>
      </div>
      <p className="mb-3 px-3 text-[10px] font-semibold tracking-[0.14em] text-sidebar-foreground/65 uppercase">
        Make work flow
      </p>
      <nav aria-label="Main navigation" className="space-y-1.5">
        {navigation.map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            onClick={close}
            aria-current={
              pathname === href ||
              (href !== "/" && pathname.startsWith(`${href}/`))
                ? "page"
                : undefined
            }
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-3 text-sm font-medium transition-colors hover:bg-sidebar-foreground/10 focus-visible:outline-sidebar-foreground",
              pathname === href ||
                (href !== "/" && pathname.startsWith(`${href}/`))
                ? "bg-sidebar-foreground/15 text-sidebar-foreground shadow-sm hover:bg-sidebar-foreground/20"
                : "text-sidebar-foreground/85",
            )}
          >
            <Icon size={18} strokeWidth={1.8} />
            {label}
          </Link>
        ))}
      </nav>
      <div className="mt-auto pt-10">
        <div className="rounded-xl bg-sidebar-foreground/8 p-4">
          <Sprout size={21} className="mb-3 text-sidebar-foreground/80" />
          <p className="text-sm font-medium">Room to grow.</p>
          <p className="mt-1.5 text-xs leading-relaxed text-sidebar-foreground/75">
            A workspace shaped around your team, one project at a time.
          </p>
        </div>
        <div className="mt-5 flex items-center gap-2 px-1 text-xs text-sidebar-foreground/65">
          <CircleHelp size={15} />
          {installationName}
        </div>
      </div>
    </div>
  );
}

export function AppShell({
  children,
  installationName,
  workspaceName,
  ownerName,
}: {
  children: React.ReactNode;
  installationName?: string;
  workspaceName?: string;
  ownerName?: string;
}) {
  const pathname = usePathname();
  const mobileOpen = useUiStore((state) => state.mobileNavigationOpen);
  const setMobileOpen = useUiStore((state) => state.setMobileNavigationOpen);
  const title =
    navigation.find(
      (item) =>
        item.href === pathname ||
        (item.href !== "/" && pathname.startsWith(`${item.href}/`)),
    )?.label ?? "Workspace";
  return (
    <div className="min-h-svh yuzu-workspace">
      <a
        href="#main-content"
        className="sr-only z-50 rounded bg-sidebar-foreground p-3 text-primary focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>
      <aside className="fixed inset-y-0 left-0 hidden w-56 lg:block">
        <Sidebar
          installationName={installationName}
          workspaceName={workspaceName}
        />
      </aside>
      <div className="lg:pl-56">
        <header className="yuzu-topbar sticky top-0 z-20 flex h-16 items-center justify-between gap-3 border-b bg-card px-5 sm:px-9 lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="lg:hidden"
                  aria-label="Open navigation"
                >
                  <Menu size={20} />
                </Button>
              </SheetTrigger>
              <SheetContent
                side="left"
                className="w-72 border-0 p-0 text-sidebar-foreground"
                showCloseButton={true}
              >
                <SheetTitle className="sr-only">
                  Workspace navigation
                </SheetTitle>
                <SheetDescription className="sr-only">
                  Navigate between workspace overview, boards, approvals, and
                  settings.
                </SheetDescription>
                <Sidebar
                  close={() => setMobileOpen(false)}
                  installationName={installationName}
                  workspaceName={workspaceName}
                />
              </SheetContent>
            </Sheet>
            <span className="hidden text-sm text-muted-foreground sm:inline">
              Workspace
            </span>
            <ChevronRight
              size={14}
              className="hidden text-muted-foreground/60 sm:block"
            />
            <span className="truncate text-sm font-medium">{title}</span>
          </div>
          <div className="flex items-center gap-2 sm:gap-4">
            <SignOut />
            <ModeSwitcher />
            <div className="hidden h-8 w-px bg-border sm:block" />
            <div
              aria-label="Yuzu workspace"
              className="flex size-9 items-center justify-center rounded-full bg-brand-cream text-sm font-semibold text-primary"
            >
              {ownerName?.charAt(0).toUpperCase() ?? "Y"}
            </div>
          </div>
        </header>
        <main
          id="main-content"
          tabIndex={-1}
          className="mx-auto max-w-[1440px] px-5 py-8 outline-none sm:px-9 sm:py-10 lg:px-8"
        >
          {children}
        </main>
      </div>
    </div>
  );
}
