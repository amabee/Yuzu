import type { Metadata } from "next";
import { headers } from "next/headers";
import { workspaceContext } from "@/server/workspace-access";
import { notificationInbox } from "@/server/notification-service";
import { NotificationInboxView } from "@/components/notifications/notification-inbox";
export const metadata: Metadata = { title: "Your inbox" };
export default async function NotificationsPage() {
  const { user, settings } = await workspaceContext();
  return (
    <NotificationInboxView
      principalId={user.id}
      timezone={settings.timezone}
      initialData={await notificationInbox(await headers())}
    />
  );
}
