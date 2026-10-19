import Link from "next/link";
import { workspaceContext } from "@/server/workspace-access";
import { isAdministrator } from "@/server/team-access";
import { configuredOrigin } from "@/server/setup/security";
import { apiEndpoints } from "@/lib/api-registry";
import { fieldsOf } from "@/lib/openapi";
import {
  ApiSettings,
  type ReferenceEndpoint,
} from "@/components/settings/api-settings";

export const metadata = { title: "API" };
export default async function ApiPage() {
  const { user } = await workspaceContext();
  // Schemas stay on the server; the page gets plain field lists.
  const reference: ReferenceEndpoint[] = apiEndpoints.map((endpoint) => ({
    method: endpoint.method,
    path: endpoint.path,
    group: endpoint.group,
    summary: endpoint.summary,
    description: endpoint.description ?? null,
    access: endpoint.access,
    returns: endpoint.returns,
    query: fieldsOf(endpoint.query),
    body: fieldsOf(endpoint.body),
  }));
  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/settings" className="text-xs text-muted-foreground">
        ← Settings
      </Link>
      <h1 className="mt-3 text-3xl font-semibold">API</h1>
      <p className="mt-3 mb-6 text-sm text-muted-foreground">
        Connect scripts and tools to Yuzu. A token acts as you, with exactly
        your access.
      </p>
      <ApiSettings
        currentUserId={user.id}
        isAdmin={isAdministrator(user.role)}
        baseUrl={`${configuredOrigin()}/api/v1`}
        reference={reference}
      />
    </div>
  );
}
