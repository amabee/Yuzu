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

| Feature | Description |
| --- | --- |
| **Flexible workspaces and boards** | Organize work into workspaces, folders, boards, groups, and items. |
| **Custom fields** | Model the information your team needs: statuses, dates, numbers, people, links, and more. |
| **Multiple views** | Work with the same records in table and Kanban views. |
| **Task details and collaboration** | Comments, mentions, attachments, notifications, and activity history. |
| **Filters and saved views** | Focus on the records that matter to you. |
| **Dashboards and reporting** | Turn work data into useful summaries and charts. |
| **Workflow automation** | Connect triggers, conditions, and actions to reduce repetitive work. |
| **CSV import and export** | Move data in and out with validation and clear feedback. |
| **REST API** | Integrate Yuzu with other tools and services. |
| **Self-hosting** | Run a separate Yuzu installation and database for your organization. |
| **Yuzu Blueprint** *(long-term)* | Package and share reusable board structures, views, forms, dashboards, and workflow definitions. |
| **App Builder** *(long-term)* | Build internal CRUD applications on top of structured work data. |

## Project status

> [!WARNING]
> Yuzu is an early-stage project and is **not yet production-ready**.

The initial focus is a reliable foundation: authentication, permissions,
workspaces, boards, flexible fields, and core collaboration.

- [ ] Foundation, project setup, and database
- [ ] Authentication, invitations, and roles
- [ ] Workspaces, folders, boards, groups, and items
- [ ] Custom fields and flexible board data
- [ ] Table and Kanban views
- [ ] Task details, comments, and activity history
- [ ] Dashboards and CSV import/export
- [ ] REST API and OpenAPI documentation
- [ ] Workflow automation engine
- [ ] Deployment, backup, restore, and security hardening
- [ ] Yuzu Blueprint and App Builder exploration

## Technology

| Area | Planned technology |
| --- | --- |
| Web application | Next.js App Router, React, TypeScript |
| UI | Tailwind CSS, shadcn/ui, Lucide |
| Data tables | TanStack Table |
| Drag and drop | dnd-kit |
| Workflow editor | React Flow (`@xyflow/react`) |
| Charts | Recharts |
| Forms and validation | React Hook Form, Zod |
| Database | PostgreSQL |
| ORM | Prisma |
| API | REST, with OpenAPI documentation |
| Background jobs | Redis and BullMQ when needed |
| Deployment | Docker Compose |
| Package management | pnpm |

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

Yuzu is still in development, so setup instructions will be added once the
initial application foundation is ready.

<details>
<summary>What this section will cover</summary>

1. Prerequisites and environment variables.
2. Installing dependencies.
3. Starting PostgreSQL and other required services.
4. Applying database migrations.
5. Running the development server.
6. Creating the first account and workspace.

</details>

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

| Phase | Focus | Scope |
| :-: | --- | --- |
| 1 | **Foundation** | Repository structure, database, validation, and shared components. |
| 2 | **Core work management** | Authentication, workspaces, boards, items, custom fields, and views. |
| 3 | **Collaboration** | Task details, comments, activity, notifications, and reporting. |
| 4 | **Automation** | Triggers, conditions, actions, workflow execution, and monitoring. |
| 5 | **Beta readiness** | Permissions testing, deployment documentation, backups, restore testing, and security hardening. |
| 6 | **Extensibility** | Yuzu Blueprint, internal App Builder, and integration tooling. |

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