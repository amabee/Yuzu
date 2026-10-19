import Link from "next/link";
import { forbidden } from "next/navigation";
import { workspaceContext } from "@/server/workspace-access";
import { isAdministrator } from "@/server/team-access";
import { AuditLog } from "@/components/team/audit-log";

export const metadata = { title: "Audit log" };
export default async function AuditPage() {
  const { user, settings } = await workspaceContext();
  if (!isAdministrator(user.role)) forbidden();
  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/settings" className="text-xs text-muted-foreground">
        ← Settings
      </Link>
      <h1 className="mt-3 text-3xl font-semibold">Audit log</h1>
      <p className="mt-3 mb-6 text-sm text-muted-foreground">
        Who changed access and settings, and when.
      </p>
      <AuditLog currentUserId={user.id} timezone={settings.timezone ?? "UTC"} />
    </div>
  );
}
