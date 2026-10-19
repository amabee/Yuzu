import Link from "next/link";
import { headers } from "next/headers";
import { emailSettings } from "@/server/email-service";
import { EmailSettingsForm } from "@/components/settings/email-settings-form";

export const metadata = { title: "Email notifications" };
export default async function EmailNotificationsPage() {
  const initial = await emailSettings(await headers());
  return (
    <div>
      <Link href="/settings" className="text-xs text-muted-foreground">
        ← Settings
      </Link>
      <EmailSettingsForm initial={initial} />
    </div>
  );
}
