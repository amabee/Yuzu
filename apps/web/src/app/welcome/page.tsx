import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Bricolage_Grotesque, Instrument_Sans } from "next/font/google";
import { setupStatus } from "@/server/setup/service";
import { Welcome } from "@/components/welcome/welcome";

const display = Bricolage_Grotesque({
  subsets: ["latin"],
  axes: ["opsz"],
  variable: "--font-display",
});
const ui = Instrument_Sans({ subsets: ["latin"], variable: "--font-ui" });

export const dynamic = "force-dynamic";
export const metadata = { title: "Welcome" };
export default async function WelcomePage() {
  const status = await setupStatus(await headers());
  if (status.phase === "READY") redirect("/");
  return <Welcome fontClassName={`${display.variable} ${ui.variable}`} />;
}
