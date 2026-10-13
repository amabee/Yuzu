import type { Metadata } from "next";
import { CheckCheck } from "lucide-react";
import { EmptyFeature } from "@/components/empty-feature";

export const metadata: Metadata = { title: "Approvals" };
export default function ApprovalsPage() {
  return (
    <EmptyFeature
      title="Approvals"
      intro="A clear place for requests, decisions, and the context behind them."
      icon={CheckCheck}
      heading="Thoughtful changes, shared decisions"
      description="Approval requests will appear here once boards and their approval policies are ready. This preview has no pending requests."
    />
  );
}
