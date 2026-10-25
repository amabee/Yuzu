import { CrmPage } from "@/server/crm-page";

export const metadata = { title: "Companies" };
export default function CompaniesPage({
  searchParams,
}: {
  searchParams: Promise<{ workspace?: string; record?: string }>;
}) {
  return <CrmPage type="COMPANY" searchParams={searchParams} />;
}
