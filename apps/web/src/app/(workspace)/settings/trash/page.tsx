import Link from "next/link";
import { workspaceContext } from "@/server/workspace-access";
import { TrashManager } from "@/components/trash/trash-manager";

export const metadata = { title: "Trash" };
export default async function TrashPage() {
  const { user } = await workspaceContext();
  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/settings" className="text-xs text-muted-foreground">
        ← Settings
      </Link>
      <h1 className="mt-3 text-3xl font-semibold">Trash</h1>
      <p className="mt-3 mb-6 text-sm text-muted-foreground">
        Deleted boards, projects and records you manage. Nothing here shows
        anywhere else until it&apos;s restored.
      </p>
      <TrashManager currentUserId={user.id} />
    </div>
  );
}
