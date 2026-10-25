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
    href: "/crm/companies",
  },
  {
    name: "Contacts",
    description: "The people you work with, at a company or on their own.",
    icon: ContactRound,
    href: "/crm/contacts",
  },
  {
    name: "Leads",
    description: "Prospects to qualify before an opportunity takes shape.",
    icon: Sprout,
  },
  {
    name: "Deals",
    description: "Opportunities moving through your sales pipelines.",
    icon: Handshake,
    href: "/crm/deals",
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
          <h2 id="crm-status">Companies, Contacts and Deals are ready</h2>
          <p>
            Keep one shared list of the businesses and people you work with,
            and move deals through your pipelines. Leads and activities are
            still being planned.
          </p>
        </div>
      </section>
      <section aria-labelledby="crm-areas">
        <div className="crm-module-section-heading">
          <h2 id="crm-areas">What lives here</h2>
        </div>
        <ul className="crm-module-areas">
          {areas.map(({ name, description, icon: Icon, href }) => (
            <li key={name} data-ready={href ? "" : undefined}>
              <Icon size={19} aria-hidden="true" />
              <div>
                <h3>
                  {href ? (
                    <Link href={href} className="crm-module-link">
                      {name}
                    </Link>
                  ) : (
                    name
                  )}
                </h3>
                <p>{description}</p>
              </div>
              {!href && <span className="crm-module-planned">Planned</span>}
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
