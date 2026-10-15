import Link from "next/link";
import { redirect } from "next/navigation";
import { getDatabase } from "@yuzu/database";
import {
  ErrorShell,
  btnPrimary,
  btnSecondary,
} from "@/components/yuzu/error-shell";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Maintenance",
  robots: { index: false, follow: false },
};
export default async function Maintenance() {
  const settings = await getDatabase().installationSettings.findUnique({
    where: { id: "installation" },
    select: { maintenanceMode: true },
  });
  if (!settings?.maintenanceMode) redirect("/");
  return (
    <ErrorShell
      mood="builder"
      code="Scheduled maintenance"
      title="We'll be right back"
      description="Yuzu is getting a quick tune-up. Please check again shortly."
    >
      <Link prefetch={false} href="/" className={btnPrimary}>
        Check again
      </Link>
      <Link prefetch={false} href="/sign-in" className={btnSecondary}>
        Administrator sign in
      </Link>
    </ErrorShell>
  );
}
