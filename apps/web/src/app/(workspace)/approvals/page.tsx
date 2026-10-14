import type { Metadata } from "next";
import { headers } from "next/headers";
import { ApprovalQueueView } from "@/components/boards/approval-queue";
import { approvalQueue } from "@/server/approval-service";
import { workspaceContext } from "@/server/workspace-access";
export const metadata: Metadata = { title: "Approvals" };
export default async function ApprovalsPage() {
  const { settings } = await workspaceContext();
  return (
    <ApprovalQueueView
      initialData={await approvalQueue(await headers())}
      timezone={settings.timezone}
    />
  );
}
