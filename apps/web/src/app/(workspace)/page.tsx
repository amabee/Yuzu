import Link from "next/link";
import {
  ArrowRight,
  CheckCheck,
  Columns3,
  FolderOpen,
  Plus,
  Settings2,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { getDatabase } from "@yuzu/database";
import { workspaceContext } from "@/server/workspace-access";
import { workspaceScope } from "@/server/team-access";

const places = [
  {
    href: "/boards",
    icon: Columns3,
    title: "Keep work in view",
    detail: "One set of tasks. The view that works for you.",
    label: "Explore boards",
  },
  {
    href: "/approvals",
    icon: CheckCheck,
    title: "Decide with context",
    detail: "Clear requests, thoughtful decisions, a shared history.",
    label: "Explore approvals",
  },
  {
    href: "/settings",
    icon: Settings2,
    title: "Make it your space",
    detail: "Set the foundations for the way your team works.",
    label: "Explore settings",
  },
];

export default async function OverviewPage() {
  const { user } = await workspaceContext();
  const board = await getDatabase().board.findFirst({
    where: { workspace: workspaceScope(user) },
    orderBy: { createdAt: "asc" },
  });
  return (
    <div>
      <div className="mb-8 flex flex-wrap items-end justify-between gap-5">
        <div>
          <p className="mb-2 text-[11px] font-semibold tracking-[0.15em] text-brand-secondary uppercase">
            A fresh start
          </p>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            Good work starts here.
          </h1>
          <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
            A little structure, a shared direction, and room for your team to
            grow.
          </p>
        </div>
        <Button disabled title="Board creation arrives in the board milestone">
          <Plus size={16} />
          Create a board
        </Button>
      </div>
      <section className="relative overflow-hidden rounded-2xl bg-brand-cream px-6 py-8 sm:px-9 sm:py-10">
        <div className="relative z-10 max-w-xl">
          <span className="mb-4 inline-flex items-center gap-2 text-xs font-medium text-primary">
            <Sparkles size={15} />
            Your next chapter, together
          </span>
          <h2 className="text-2xl leading-tight font-semibold tracking-tight text-primary sm:text-3xl">
            Don&apos;t just manage work.
            <br />
            Build the systems that run it.
          </h2>
          <p className="mt-4 max-w-md text-sm leading-6 text-foreground/75">
            Bring tasks, conversations, and decisions into one place. Start with
            a board. Shape it around the work that matters.
          </p>
          <Button
            asChild
            variant="outline"
            className="mt-6 border-primary/20 bg-card/60 text-primary hover:bg-card"
          >
            <Link href="/boards">
              Find your starting point
              <ArrowRight size={15} />
            </Link>
          </Button>
        </div>
        <div
          aria-hidden="true"
          className="absolute right-10 bottom-7 hidden h-40 w-44 rotate-[-7deg] rounded-xl border border-border/70 bg-card/50 p-4 xl:block"
        >
          <div className="mb-5 h-2 w-20 rounded bg-primary/20" />
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex gap-3">
                <div className="size-4 rounded border border-primary/20" />
                <div className="h-3 flex-1 rounded bg-primary/10" />
              </div>
            ))}
          </div>
        </div>
      </section>
      <section aria-labelledby="boards-heading" className="mt-9">
        <div className="mb-4 flex items-center justify-between">
          <h2 id="boards-heading" className="text-base font-semibold">
            Your boards
          </h2>
          <Link
            href="/boards"
            className="flex items-center gap-1 text-xs font-medium text-primary hover:underline"
          >
            View boards
            <ArrowRight size={13} />
          </Link>
        </div>
        <div className="flex flex-col items-center rounded-xl border border-dashed bg-card px-5 py-10 text-center">
          <div className="mb-4 flex size-12 items-center justify-center rounded-xl bg-secondary">
            <FolderOpen size={23} className="text-primary" />
          </div>
          <h3 className="text-sm font-semibold">
            {board?.name ?? "A clean slate for your next project"}
          </h3>
          <p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">
            Your starter board is saved. No sample tasks have been created.
          </p>
          {board && (
            <Button asChild variant="outline" className="mt-5">
              <Link href={`/boards/${board.id}`}>
                Open your board
                <ArrowRight size={15} />
              </Link>
            </Button>
          )}
        </div>
      </section>
      <div className="mt-7 grid gap-4 md:grid-cols-3">
        {places.map(({ href, icon: Icon, title, detail, label }) => (
          <Link
            key={href}
            href={href}
            className="group rounded-xl border bg-card p-5 transition-colors hover:border-brand-secondary/50"
          >
            <Icon size={20} strokeWidth={1.7} className="mb-5 text-primary" />
            <h2 className="text-sm font-semibold">{title}</h2>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">
              {detail}
            </p>
            <span className="mt-5 inline-flex items-center gap-2 text-xs font-medium text-primary">
              {label}
              <ArrowRight size={13} />
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
