import type { Metadata } from "next";
import { CalendarDays, Paperclip, ShieldCheck } from "lucide-react";

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
    value: "50 MB per file · planned default",
  },
  {
    icon: ShieldCheck,
    title: "Access and operations",
    description: "Invite-only membership and maintenance controls.",
    value: "Administrator access required",
  },
];
export default function SettingsPage() {
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
      <div className="mt-8 overflow-hidden rounded-xl border bg-card">
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
            <span className="text-xs text-muted-foreground">{value}</span>
          </section>
        ))}
      </div>
      <p className="mt-5 text-xs leading-5 text-muted-foreground">
        Settings are shown as a preview. Account setup and administrator
        controls arrive in the identity milestone.
      </p>
    </div>
  );
}
