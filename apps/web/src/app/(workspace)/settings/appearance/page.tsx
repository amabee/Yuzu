import Link from "next/link";
import { headers } from "next/headers";
import { forbidden } from "next/navigation";
import { workspaceContext } from "@/server/workspace-access";
import { isAdministrator } from "@/server/team-access";
import { appearanceState } from "@/server/appearance-service";
import { ThemeEditor } from "@/components/appearance/theme-editor";
import "@/components/design-preview/appearance-preview.css";

export const metadata = { title: "Appearance" };
export default async function AppearancePage() {
  const { user } = await workspaceContext();
  if (!isAdministrator(user.role)) forbidden();
  const initial = await appearanceState(await headers());
  return (
    <div>
      <Link href="/settings" className="text-xs text-muted-foreground">
        ← Settings
      </Link>
      <h1 className="mt-3 text-3xl">Appearance</h1>
      <p className="mt-2 mb-6 text-sm text-muted-foreground">
        Make Yuzu your team’s space. Preview a draft, then publish when it feels
        right.
      </p>
      <ThemeEditor initial={initial} />
    </div>
  );
}
