import type { Metadata } from "next";
import {
  CalendarDays,
  CalendarRange,
  KeyRound,
  Mail,
  Paperclip,
  ShieldCheck,
  Webhook,
} from "lucide-react";
import { WeekStartSetting } from "@/components/settings/week-start-setting";
import { PrivateWebhookSetting } from "@/components/settings/private-webhook-setting";
import Link from "next/link";
import { workspaceContext } from "@/server/workspace-access";
import { isAdministrator } from "@/server/team-access";
import { formatFileSize } from "@/lib/attachment-contract";

export const metadata: Metadata = { title: "Settings" };
const settings = [
  {
    icon: CalendarDays,
    title: "General",
    description: "Installation name, timezone, and date display.",
    value: "Set during installation",
  },
  {
    icon: Paperclip,
    title: "Files and uploads",
    description: "Attachment limits and supported file types.",
    value: "",
  },
  {
    icon: ShieldCheck,
    title: "Access and operations",
    description: "Invite-only membership and maintenance controls.",
    value: "Administrator access required",
  },
];
export default async function SettingsPage() {
  const { user, settings: installation } = await workspaceContext();
  return (
    <div>
      <p className="mb-2 text-[11px] font-semibold tracking-[0.15em] text-brand-secondary uppercase">
        Make it yours
      </p>
      <h1 className="text-3xl font-semibold tracking-tight">
        Workspace settings
      </h1>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">
        The foundations for the way your team works.
      </p>
      {isAdministrator(user.role) && (
        <Link
          href="/settings/team"
          className="mt-6 inline-flex rounded-lg bg-primary px-4 py-3 text-sm font-medium text-primary-foreground"
        >
          Manage team access
        </Link>
      )}
      {isAdministrator(user.role) && (
        <Link
          href="/settings/appearance"
          className="ml-3 mt-6 inline-flex rounded-lg border bg-card px-4 py-3 text-sm font-medium"
        >
          Customize appearance
        </Link>
      )}
      {isAdministrator(user.role) && (
        <Link
          href="/settings/workspaces"
          className="ml-3 mt-6 inline-flex rounded-lg border bg-card px-4 py-3 text-sm font-medium"
        >
          Workspaces
        </Link>
      )}
      {isAdministrator(user.role) && (
        <Link
          href="/settings/audit"
          className="ml-3 mt-6 inline-flex rounded-lg border bg-card px-4 py-3 text-sm font-medium"
        >
          Audit log
        </Link>
      )}
      {isAdministrator(user.role) && (
        <Link
          href="/settings/projects"
          className="ml-3 mt-6 inline-flex rounded-lg border bg-card px-4 py-3 text-sm font-medium"
        >
          Projects directory
        </Link>
      )}
      <div className="mt-8 overflow-hidden rounded-xl border bg-card">
        <section className="flex flex-col justify-between gap-4 border-b p-6 sm:flex-row sm:items-center">
          <div className="flex gap-4">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-secondary">
              <Mail size={19} className="text-primary" />
            </div>
            <div>
              <h2 className="text-sm font-semibold">Email notifications</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Choose which updates reach your inbox, and when.
              </p>
            </div>
          </div>
          <Link
            href="/settings/notifications"
            className="rounded-lg border bg-card px-3 py-2 text-sm font-medium"
          >
            Email notifications
          </Link>
        </section>
        <section className="flex flex-col justify-between gap-4 border-b p-6 sm:flex-row sm:items-center">
          <div className="flex gap-4">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-secondary">
              <KeyRound size={19} className="text-primary" />
            </div>
            <div>
              <h2 className="text-sm font-semibold">API</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Tokens for scripts and tools, and the API reference.
              </p>
            </div>
          </div>
          <Link
            href="/settings/api"
            className="rounded-lg border bg-card px-3 py-2 text-sm font-medium"
          >
            API tokens
          </Link>
        </section>
        {settings.map(({ icon: Icon, title, description, value }) => (
          <section
            key={title}
            className="flex flex-col justify-between gap-4 border-b p-6 last:border-b-0 sm:flex-row sm:items-center"
          >
            <div className="flex gap-4">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-secondary">
                <Icon size={19} className="text-primary" />
              </div>
              <div>
                <h2 className="text-sm font-semibold">{title}</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {description}
                </p>
              </div>
            </div>
            <span className="text-xs text-muted-foreground">
              {title === "Files and uploads"
                ? `${formatFileSize(installation.maxAttachmentSizeBytes)} per file`
                : value}
            </span>
          </section>
        ))}
        <section className="flex flex-col justify-between gap-4 p-6 sm:flex-row sm:items-center">
          <div className="flex gap-4">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-secondary">
              <CalendarRange size={19} className="text-primary" />
            </div>
            <div>
              <h2 className="text-sm font-semibold">Calendar</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                The first day of the week on every board calendar.
              </p>
            </div>
          </div>
          {isAdministrator(user.role) ? (
            <WeekStartSetting
              weekStartsOn={installation.weekStartsOn === 0 ? 0 : 1}
              revision={installation.revision}
            />
          ) : (
            <span className="text-sm text-muted-foreground">
              Weeks start on{" "}
              {installation.weekStartsOn === 0 ? "Sunday" : "Monday"}
            </span>
          )}
        </section>
        {isAdministrator(user.role) && (
          <section className="flex flex-col justify-between gap-4 border-t p-6 sm:flex-row sm:items-center">
            <div className="flex gap-4">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-secondary">
                <Webhook size={19} className="text-primary" />
              </div>
              <div>
                <h2 className="text-sm font-semibold">Automation webhooks</h2>
                <p className="mt-1 max-w-md text-sm text-muted-foreground">
                  By default, webhooks can only reach public addresses. Allow
                  local-network addresses for tools running next to Yuzu.
                </p>
              </div>
            </div>
            <PrivateWebhookSetting
              allowed={installation.allowPrivateWebhooks}
              revision={installation.revision}
            />
          </section>
        )}
      </div>
      <p className="mt-5 text-xs leading-5 text-muted-foreground">
        General settings are shown as a preview. Team invitations and membership
        management are available through Team access.
      </p>
    </div>
  );
}
