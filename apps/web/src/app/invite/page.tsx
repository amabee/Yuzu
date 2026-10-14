import { InvitationForm } from "@/components/team/invitation-form";
export const metadata = {
  title: "Join your team",
  robots: { index: false, follow: false },
  referrer: "no-referrer" as const,
};
export default function InvitePage() {
  return <InvitationForm />;
}
