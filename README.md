<div align="center">

<img src="logo.svg" alt="Yuzu logo" width="120" height="120" />

# Yuzu

**Don't just manage work. Build the systems that run it.**

An open-source work management platform for teams to organize projects,
automate workflows, and build custom business systems.

<br />

<a href="#project-status"><img height="32" alt="Status" src="https://img.shields.io/badge/STATUS-IN%20DEVELOPMENT-F4A100?style=for-the-badge" /></a>
<a href="#license"><img height="32" alt="License" src="https://img.shields.io/badge/LICENSE-TBD-lightgrey?style=for-the-badge" /></a>
<a href="#deployment"><img height="32" alt="Self-hosted" src="https://img.shields.io/badge/SELF--HOSTED-086288?style=for-the-badge" /></a>
<a href="https://www.typescriptlang.org/"><img height="32" alt="TypeScript" src="https://img.shields.io/badge/TYPESCRIPT-3178C6?style=for-the-badge&logo=typescript&logoColor=white" /></a>
<a href="https://nextjs.org/"><img height="32" alt="Next.js" src="https://img.shields.io/badge/NEXT.JS-000000?style=for-the-badge&logo=next.js" /></a>
<a href="https://www.postgresql.org/"><img height="32" alt="PostgreSQL" src="https://img.shields.io/badge/POSTGRESQL-4169E1?style=for-the-badge&logo=postgresql&logoColor=white" /></a>

<br /><br />

[About](#about) ·
[Features](#planned-features) ·
[Status](#project-status) ·
[Technology](#technology) ·
[Architecture](#architecture-principles) ·
[Getting started](#getting-started) ·
[Roadmap](#roadmap)

</div>

---

## About

Yuzu is an open-source, self-hostable work management platform inspired by
modern work operating systems. It aims to bring project tracking, team
collaboration, flexible data management, and workflow automation together in
one customizable workspace.

Yuzu is designed to grow beyond task management. The long-term goal is to help
teams create the tools and processes that fit the way they work, without having
to build every internal system from scratch.

> **Our vision:** Manage your work, automate your processes, and build the
> systems that run your business.

## Planned features

> [!NOTE]
> Yuzu is under active development. This list describes the intended product
> direction; features may not be available yet.

| Feature                            | Description                                                                                      |
| ---------------------------------- | ------------------------------------------------------------------------------------------------ |
| **Flexible workspaces and boards** | Organize work into workspaces, folders, boards, groups, and items.                               |
| **Custom fields**                  | Model the information your team needs: statuses, dates, numbers, people, links, and more.        |
| **Multiple views**                 | Work with the same records in table and Kanban views.                                            |
| **Task details and collaboration** | Comments, mentions, attachments, notifications, and activity history.                            |
| **Filters and saved views**        | Focus on the records that matter to you.                                                         |
| **Dashboards and reporting**       | Turn work data into useful summaries and charts.                                                 |
| **Workflow automation**            | Connect triggers, conditions, and actions to reduce repetitive work.                             |
| **CSV import and export**          | Move data in and out with validation and clear feedback.                                         |
| **REST API**                       | Integrate Yuzu with other tools and services.                                                    |
| **Self-hosting**                   | Run a separate Yuzu installation and database for your organization.                             |
| **Yuzu Blueprint** _(long-term)_   | Package and share reusable board structures, views, forms, dashboards, and workflow definitions. |
| **App Builder** _(long-term)_      | Build internal CRUD applications on top of structured work data.                                 |

## Project status

> [!WARNING]
> Yuzu is an early-stage project and is **not yet production-ready**.

The initial focus is a reliable foundation: authentication, permissions,
workspaces, boards, flexible fields, and core collaboration.

- [x] Foundation, database, UUIDv7 records, and responsive shadcn UI
- [x] First installation, sign-in, invitations, and password recovery
- [x] Global theme editor, dynamic colors/type, and personal light/dark mode
- [x] Boards, groups, real tasks, and typed custom fields
- [x] Table and Kanban views with task details, filtering, and sorting
- [x] Creator/assignee/editor permissions and scoped board managers
- [x] Revision conflict protection, task history, archive/restore
- [x] Task comments, configurable tag/status/priority appearance, and operation toasts
- [ ] Remaining profile/account and workspace lifecycle administration
- [x] Approval policies, primary/backup decisions, and a private review queue
- [x] Realtime board synchronization and persistent assignment/approval notifications
- [x] Teammate mentions, comment editing with history, and authorized removal
- [ ] Files and saved views
- [ ] Dashboards, CSV exchange, and complete OpenAPI documentation
- [ ] Workflow automation and Blueprint/App Builder exploration
- [ ] Release deployment, recovery, and pilot verification

Use **Boards → Create board** or open an existing board and choose **Add task**.
New boards use direct editing. Configure approvals in **Board details** and
review requests under **Approvals**. **Inbox** and the header bell show your
assignments, approval requests and decisions, including updates received offline.
Opening a notification rechecks current access before linking to its task or
review sheet. Mark individual notifications read/unread or clear the current
unread backlog; newer arrivals remain unread.
In a task's **Comments** tab, type `@` and a name, then choose the teammate from
the inline suggestions to notify them. Authors can edit their comments and inspect previous versions;
authors and board managers can remove comments. Removal hides the content and
keeps an audit record. Archived tasks remain read-only.
Each task also has its own checklist: add, rename, complete or remove steps in
the task details, then save. Empty checklists stay off task cards. Multi-select
custom fields continue to use the board's shared options. In **Board details**,
managers can remove a group only when no active/archived task or pending approval
request references it.
See [Board engine](docs/board-engine.md) for permissions and API contracts.

## Technology

| Area                     | Planned technology                    |
| ------------------------ | ------------------------------------- |
| Web application          | Next.js App Router, React, TypeScript |
| UI                       | Tailwind CSS, shadcn/ui, Lucide       |
| Data tables              | TanStack Table                        |
| Server data and requests | TanStack Query                        |
| Client UI state          | Zustand                               |
| Drag and drop            | dnd-kit                               |
| Workflow editor          | React Flow (`@xyflow/react`)          |
| Charts                   | Recharts                              |
| Forms and validation     | React Hook Form, Zod                  |
| Database                 | PostgreSQL                            |
| ORM                      | Prisma                                |
| API                      | REST, with OpenAPI documentation      |
| Background jobs          | Redis and BullMQ when needed          |
| Deployment               | Docker Compose                        |
| Package management       | pnpm                                  |

<sub>The stack and package choices may evolve during development.</sub>

## Architecture principles

Yuzu is intended to use a **modular monolith** rather than starting with a
collection of microservices.

- **Single-tenant per deployment:** each organization gets its own Yuzu
  installation and database.
- **Separation of concerns:** business rules belong in application services,
  not inside UI components or HTTP handlers.
- **Centralized authorization:** protected operations must enforce permissions
  on the server.
- **Flexible board data:** custom fields should not require a database schema
  migration every time a user adds a column.
- **Secure automation:** workflows should use validated, allow-listed actions,
  execution logs, idempotency, and bounded retries, not unrestricted
  user-supplied code.
- **Reliable data handling:** use transactions where appropriate and design for
  backup and restore.
- **API consistency:** provide predictable responses, validation errors, and
  versioned API routes.

## Getting started

The foundation and first-installation wizard are runnable, including a protected
owner account, email receipt verification, and a persisted initial workspace and
board structure. Email invitations, password recovery, and workspace membership are available.
Editable tasks, approvals, and collaboration follow in later milestones.

Use Node.js 24, pnpm 11.9.0, and a running Docker engine. From the repository root:

```powershell
Copy-Item .env.example .env # First setup only; preserve existing configuration.
pnpm install --frozen-lockfile
pnpm setup:keys
pnpm services:up
pnpm db:generate
pnpm db:deploy
pnpm db:check
pnpm dev
```

Open [127.0.0.1:3000](http://127.0.0.1:3000). See [local development](docs/development.md)
for checks, database changes, troubleshooting, and current limitations.

Follow [first installation](docs/installation.md): copy the generated setup key
from the server's `.env`, create the owner, and verify email delivery. No sample
tasks are created. After installation, open Settings → Manage team access to
invite teammates into a workspace. Invitations expire after seven days; resending
replaces the previous link. New users create an account, while existing users
sign in with the invited email before accepting. Owners/admins manage membership;
ordinary members only see boards in their current workspaces.

Generated record IDs use UUIDv7. Use `ORDER BY id` for time-oriented ordering, or
`ORDER BY "createdAt", id` when querying exact creation dates with a stable tie-breaker.
Named installation, bootstrap, recovery, and rate-limit keys retain their defined
string formats. Existing local data can be upgraded with `pnpm db:upgrade:ids`;
this preserves accounts, credentials, memberships, boards, and their creation dates,
while signing out existing sessions and invalidating recovery records when IDs change.

Use **Forgot password?** on the sign-in page to request a recovery email. Links
expire after 30 minutes, work once, and are replaced by a newer request. A successful
reset signs out all sessions for that account. Recovery requires verified email
configuration; request responses do not disclose whether an account exists.

For local email testing, `pnpm services:up` also starts Mailpit. In Yuzu's email
setup, use SMTP host `127.0.0.1`, port `1025`, SSL off, and blank username and
password. Use a sender such as `noreply@yuzu.test`, then read the verification
code in [Mailpit's inbox](http://127.0.0.1:8025). Messages are stored in a Docker
volume for testing rather than delivered to real inboxes.

> [!CAUTION]
> Avoid using Yuzu with important production data until deployment and recovery
> procedures are documented and tested.

## Deployment

The intended deployment model is self-hosted, with a separate installation and
database for each organization. Docker Compose is the initial deployment
target.

Production deployment guidance will include environment configuration, secure
secrets, database migrations, file storage, backups, restore testing, and
upgrade procedures before Yuzu is considered production-ready.

## Contributing

Contributions, feedback, bug reports, and thoughtful feature ideas are welcome
as the project takes shape.

Before opening a pull request:

1. Check existing issues and discussions to avoid duplicate work.
2. Describe the problem your change solves.
3. Keep changes focused and include tests where practical.
4. Update documentation when behavior or setup changes.
5. Never commit secrets, credentials, private customer data, or real
   environment files.

Contribution guidelines and issue templates will be added as the project
matures.

## Roadmap

| Phase | Focus                    | Scope                                                                                            |
| :---: | ------------------------ | ------------------------------------------------------------------------------------------------ |
|   1   | **Foundation**           | Repository structure, database, validation, and shared components.                               |
|   2   | **Core work management** | Authentication, workspaces, boards, items, custom fields, and views.                             |
|   3   | **Collaboration**        | Task details, comments, activity, notifications, and reporting.                                  |
|   4   | **Automation**           | Triggers, conditions, actions, workflow execution, and monitoring.                               |
|   5   | **Beta readiness**       | Permissions testing, deployment documentation, backups, restore testing, and security hardening. |
|   6   | **Extensibility**        | Yuzu Blueprint, internal App Builder, and integration tooling.                                   |

## Security

Please do not report security vulnerabilities in public issues. Until a
dedicated security policy is available, contact the repository owner privately
through GitHub to coordinate responsible disclosure.

Never include credentials, tokens, personal data, or production database
contents in a report.

## License

The project's license has not been finalized yet. A license will be added before
the project is publicly released for reuse and contributions. Until a license is
present, do not assume the code is available under an open-source license.

## The idea behind Yuzu

Work management should be more than a list of tasks. Every team has its own
processes, information, and ways of working. Yuzu aims to provide a flexible
foundation for organizing that work, and eventually building the systems around
it.

---

<div align="center">

**Yuzu: Don't just manage work. Build the systems that run it.**

<sub>Made for teams that want more control over how they work.</sub>

</div>
