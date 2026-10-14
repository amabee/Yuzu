import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getDatabase } from "@yuzu/database";
import { getAuth } from "@/server/auth";
import { SignInForm } from "@/components/setup/sign-in-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sign in" };
export default async function SignInPage() {
  const settings = await getDatabase().installationSettings.findUnique({
    where: { id: "installation" },
  });
  if (!settings?.ownerId) redirect("/welcome");
  const session = await getAuth().api.getSession({ headers: await headers() });
  if (session && settings.setupState === "READY") redirect("/");
  if (session?.user.id === settings.ownerId) redirect("/setup");
  return <SignInForm />;
}
