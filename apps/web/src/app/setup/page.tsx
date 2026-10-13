import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { setupStatus } from "@/server/setup/service";
import { SetupWizard } from "@/components/setup/setup-wizard";

export const dynamic = "force-dynamic";
export const metadata = { title: "Set up your installation" };
export default async function SetupPage() {
  const status = await setupStatus(await headers());
  if (status.phase === "READY") redirect("/");
  return <SetupWizard initial={status} />;
}
