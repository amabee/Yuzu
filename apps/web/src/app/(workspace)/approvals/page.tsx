import type { Metadata } from "next";
import { headers } from "next/headers";
import { ApprovalQueueView } from "@/components/boards/approval-queue";
import { approvalQueue } from "@/server/approval-service";
import { workspaceContext } from "@/server/workspace-access";
export const metadata: Metadata = { title: "Approvals" };
export default async function ApprovalsPage({
  searchParams,
}: {
  searchParams: Promise<{ request?: string }>;
}) {
  const { settings } = await workspaceContext();
  const { request } = await searchParams;
  return (
    <ApprovalQueueView
      initialData={await approvalQueue(
        await headers(),
        request ? "ALL" : "PENDING",
        undefined,
        request,
      )}
      initialRequestId={request}
      timezone={settings.timezone}
    />
  );
}
