import { CrmPage } from "@/server/crm-page";

export const metadata = { title: "Contacts" };
export default function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<{ workspace?: string; record?: string }>;
}) {
  return <CrmPage type="CONTACT" searchParams={searchParams} />;
}
