import Link from "next/link";
import {
  Building2,
  ContactRound,
  Handshake,
  Sprout,
  CalendarClock,
} from "lucide-react";
import { PageCrumbs } from "@/components/page-crumbs";
import { workspaceContext } from "@/server/workspace-access";

export const metadata = { title: "CRM" };
const areas = [
  {
    name: "Companies",
    description: "The businesses you work with.",
    icon: Building2,
  },
  {
    name: "Contacts",
    description: "People, their roles, and their company relationships.",
    icon: ContactRound,
  },
  {
    name: "Leads",
    description: "Prospects to qualify before an opportunity takes shape.",
    icon: Sprout,
  },
  {
    name: "Deals",
    description: "Opportunities, pipelines, and sales outcomes.",
    icon: Handshake,
  },
  {
    name: "Activities",
    description: "Customer conversations and follow-ups.",
    icon: CalendarClock,
  },
];

export default async function CrmPage() {
  const { workspace } = await workspaceContext();
  return (
    <div className="crm-module-page">
      <PageCrumbs items={[{ label: "CRM" }]} />
      <header>
        <p className="text-sm text-muted-foreground">
          {workspace?.name ?? "Your workspace"}
        </p>
        <h1>Customer relationships</h1>
        <p className="text-muted-foreground">
          A dedicated space for sales and customers, connected to the work you
          deliver.
        </p>
      </header>
      <section aria-labelledby="crm-status" className="crm-module-status">
        <ContactRound size={25} aria-hidden="true" />
        <div>
          <h2 id="crm-status">CRM is being prepared</h2>
          <p>
            The module navigation is in place. Customer records and sales tools
            are still being planned; they are not available yet.
          </p>
        </div>
      </section>
      <section aria-labelledby="crm-areas">
        <div className="crm-module-section-heading">
          <h2 id="crm-areas">What will live here</h2>
          <span>Planned</span>
        </div>
        <ul className="crm-module-areas">
          {areas.map(({ name, description, icon: Icon }) => (
            <li key={name}>
              <Icon size={19} aria-hidden="true" />
              <div>
                <h3>{name}</h3>
                <p>{description}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>
      <footer className="crm-module-footer">
        <div>
          <h2>Projects and tasks stay in Work</h2>
          <p>
            Existing boards, including Deal boards, are unchanged. Shared
            search, approvals, notifications and settings remain available from
            both modules.
          </p>
        </div>
        <Link
          href="/boards"
          className="inline-flex shrink-0 items-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
        >
          Open Work boards
        </Link>
      </footer>
    </div>
  );
}
