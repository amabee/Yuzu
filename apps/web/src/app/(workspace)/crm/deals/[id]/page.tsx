import { notFound } from "next/navigation";
import { getDatabase } from "@yuzu/database";
import { DealsScreen } from "@/components/crm/deals-screen";
import { recordId } from "@/lib/id-contract";
import { crmCollection } from "@/server/crm-service";
import { boardScope } from "@/server/team-access";
import { workspaceContext } from "@/server/workspace-access";

export const metadata = { title: "Deals" };
export default async function PipelinePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ record?: string }>;
}) {
  const id = recordId.safeParse((await params).id);
  if (!id.success) notFound();
  const { user } = await workspaceContext();
  const board = await getDatabase().board.findFirst({
    where: { id: id.data, pipeline: { isNot: null }, ...boardScope(user) },
    select: {
      id: true,
      workspaceId: true,
      workspace: { select: { name: true } },
    },
  });
  if (!board) notFound();
  // Deals point at the workspace's Companies and Contacts; their cards stack.
  const [companies, contacts] = await Promise.all([
    crmCollection(user, board.workspaceId, "COMPANY"),
    crmCollection(user, board.workspaceId, "CONTACT"),
  ]);
  return (
    <DealsScreen
      key={board.id}
      scope={{
        principalId: user.id,
        workspaceId: board.workspaceId,
        boardId: board.id,
        relatedBoardId: companies,
        type: "COMPANY",
      }}
      contactsBoardId={contacts}
      workspaceName={board.workspace.name}
      initialDeal={recordId.safeParse((await searchParams).record).data ?? null}
    />
  );
}
