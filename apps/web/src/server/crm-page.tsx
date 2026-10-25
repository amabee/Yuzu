import { getDatabase } from "@yuzu/database";
import { Building2, ContactRound } from "lucide-react";
import { CrmDirectoryScreen } from "@/components/crm/crm-directory";
import { EmptyFeature } from "@/components/empty-feature";
import { recordId } from "@/lib/id-contract";
import { crmCollection } from "./crm-service";
import { SetupError } from "./setup/security";
import { workspaceScope } from "./team-access";
import { workspaceContext } from "./workspace-access";

/** The Companies or Contacts screen of a workspace the person fully belongs
 *  to (project-only invitees don't see CRM collections). */
export async function CrmPage({
  type,
  searchParams,
}: {
  type: "COMPANY" | "CONTACT";
  searchParams: Promise<{ workspace?: string; record?: string }>;
}) {
  const params = await searchParams;
  const { user, workspace: initial } = await workspaceContext();
  const workspaces = await getDatabase().workspace.findMany({
    where: workspaceScope(user),
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true },
  });
  const workspace =
    workspaces.find((item) => item.id === params.workspace) ??
    workspaces.find((item) => item.id === initial?.id) ??
    workspaces[0];
  const title = type === "COMPANY" ? "Companies" : "Contacts";
  const unavailable = (heading: string, description: string) => (
    <EmptyFeature
      title={title}
      intro="Customer records are shared by everyone in a workspace."
      icon={type === "COMPANY" ? Building2 : ContactRound}
      heading={heading}
      description={description}
    />
  );
  if (!workspace)
    return unavailable(
      `${title} aren't available to you`,
      "CRM is shared by workspace members. Ask an administrator to add you to a workspace.",
    );
  let boardId: string, relatedBoardId: string;
  try {
    boardId = await crmCollection(user, workspace.id, type);
    relatedBoardId = await crmCollection(
      user,
      workspace.id,
      type === "COMPANY" ? "CONTACT" : "COMPANY",
    );
  } catch (error) {
    if (error instanceof SetupError)
      return unavailable(`${title} couldn't open`, error.message);
    throw error;
  }
  return (
    <CrmDirectoryScreen
      key={`${workspace.id}:${type}`}
      scope={{
        principalId: user.id,
        workspaceId: workspace.id,
        boardId,
        relatedBoardId,
        type,
      }}
      workspaceName={workspace.name}
      initialRecord={recordId.safeParse(params.record).data ?? null}
    />
  );
}
