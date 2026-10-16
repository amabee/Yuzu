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

## Private task files

The task Files tab supports uploads, downloads and permission-checked removal.
The default upload limit is **50 MB (50,000,000 bytes)**. Supported formats are
JPEG, PNG, GIF, WebP, PDF, UTF-8 TXT/CSV and modern Office documents. The server
enforces the installation's size/MIME policy and checks file contents. Signature
checks identify formats; they do not replace malware scanning.

New installations use **SeaweedFS through the S3 API**. Run `pnpm setup:keys` to
generate server-only storage credentials, then `pnpm services:up`. Docker runs a
pinned SeaweedFS Mini image with persistent `seaweedfs_data`, authenticated S3 on
`127.0.0.1:8333`, and a private `yuzu-attachments` bucket. The authenticated admin
console is available at **http://127.0.0.1:23646**. Use `YUZU_SEAWEED_ADMIN_USER`
(default `admin`) and the generated `YUZU_SEAWEED_ADMIN_PASSWORD` from `.env`.
Open the file browser and navigate to `/buckets/yuzu-attachments/attachments/`.
Objects use UUID filenames; original filenames are stored in Yuzu's database.
The console can bypass Yuzu's task permissions, so use the app to add/remove task
attachments. Other storage interfaces are not published. This is a single-node deployment; it does not provide host
failure redundancy.

`YUZU_STORAGE_PROVIDER=S3` selects storage for **new** uploads. Configure
`YUZU_S3_ENDPOINT`, `YUZU_S3_BUCKET`, `YUZU_S3_REGION`, `YUZU_S3_ACCESS_KEY_ID`, and
`YUZU_S3_SECRET_ACCESS_KEY` on the server. `YUZU_S3_FORCE_PATH_STYLE=true` supports
SeaweedFS; it can be disabled for providers using virtual-host bucket addressing.
Provision the bucket before starting Yuzu. If the web app runs in Docker, use
`http://seaweedfs:8333` on its private Docker network rather than the host address.
Credentials never reach browsers; Yuzu checks task access and streams downloads.
Readiness checks include access to the configured S3 bucket.

Each attachment records its provider and bucket. Existing disk attachments stay
readable when enabling S3; changing the default does not move them. Keep the S3
endpoint configured while any S3 attachments remain. Changing endpoints requires
copying existing objects and verifying them first.

`YUZU_UPLOAD_DIR` is the private local staging directory for size/content checks
(default `apps/web/storage/attachments`). In S3 mode, validated uploads are copied
to object storage and staging files are removed. `LOCAL` mode retains files on
disk instead. Set an absolute directory on a shared server; keep it outside
public/static hosting. Web instances using LOCAL must share this directory.
Reverse proxies must allow the configured request size and upload duration.

To move existing files, apply migrations with `pnpm db:deploy`, configure S3,
then run `pnpm attachments:migrate-s3`. It verifies the local source and a full
S3 download against the database size and SHA-256 before changing each row.
It preserves local originals and can resume safely after interruption. Enable
maintenance mode and drain active uploads/removals before migrating or backing
up. Back up PostgreSQL **and** SeaweedFS's persistent volume (plus any remaining
local files); restore matching metadata and file contents together. Preserved
local originals are rollback copies, not automatic rollback of database locations.

Archived tasks preserve files. Removal hides the attachment immediately, then
attempts physical cleanup. `pnpm attachments:cleanup` removes unreferenced UUIDv7
disk files and, in S3 mode, objects under `attachments/` in the configured bucket
that are older than 24 hours. Active references, migration originals, and recent
files are preserved. Run cleanup for each previous bucket if bucket configuration
changes. No recurring cleanup job is installed automatically.

Run `pnpm --filter @yuzu/database test:storage` for real S3 integrity/access tests
against local SeaweedFS. Browser tests default to isolated LOCAL storage; set
`YUZU_E2E_S3=1` to exercise the same upload/permission/download workflows against
the separate `yuzu-e2e-attachments` bucket.
Set `YUZU_E2E_DEV=1` to run the browser tests through Turbopack development mode
with separate build output. The binary-file regression checks JPG/PDF validation
and verifies that runtime uploads do not trigger unsolicited document reloads.

## CSV task export

Use **Export CSV** in a board's toolbar. **Current view** keeps the current search,
filters, sorting, and active/archive selection. **Entire board** exports active tasks;
select **Include archived tasks** to add archived records. Each export uses a fresh,
consistent snapshot of accepted task values.

Anyone with current board viewing access can export its data. Access is checked again
before the response is returned, and an audit event records the actor, range and row
count. Personal view definitions and pending proposal contents stay private.

CSV files use UTF-8 with a BOM, CRLF records, quoted cells, and spreadsheet formula
protection for text. They include task IDs, descriptions, status/priority labels,
ISO due dates, groups, assignees, checklists and active custom fields. Collection
cells use JSON arrays; checklists contain ordered `{ text, done }` entries. Boolean
values use `TRUE`/`FALSE`, numbers retain zero/negative values, and missing values are
blank. Custom column headers are disambiguated when names collide.

Exports support up to 10,000 matching tasks or 10,000,000 UTF-8 bytes. Oversized or
timed-out exports return an error without a partial download. The server reads
100-task batches with a 30-second snapshot timeout and a 50,000-task scan ceiling;
use narrower status/group/assignee/priority filters for large boards. Closing the
export panel hands preparation to the worker. Follow the floating lemon across
navigation or refresh, then choose **Download CSV** when the file is ready.

The authenticated, same-origin JSON endpoint is `POST /api/v1/boards/export`:

```json
{ "boardId": "<board UUID>", "scope": "BOARD", "includeArchived": false }
```

For the current view, send `{ boardId, scope: "VIEW", config }` using the saved-view
configuration contract. Successful responses are private, non-cacheable CSV
attachments. Validation, permission, maintenance and size failures use the normal
JSON API error envelope. Use database and object-storage backups for full recovery.

## CSV import

Open **Import CSV** on a board, choose a UTF-8 comma-separated file, and map its
columns to task properties or existing custom fields. Imports accept up to 25 MB,
25,000 task rows, and 100 columns per file. Preview validates at most 500 rows / 1 MB
per request and displays 100 rows per page. Duplicates are checked across the entire
file as well as against existing tasks. Preview does not write tasks. Unmapped
columns are ignored; unmapped or empty values use normal task-creation defaults.

Dates use `YYYY-MM-DD`. Statuses, priorities, groups, tags, selections and people must match
saved labels/names or IDs; ambiguous names are rejected. Multiple values accept a
JSON string array or `|` separators. Checklists accept `|`-separated steps or a
JSON array such as `[{"text":"Review draft","done":false}]`. Imports never add
board fields/options automatically and never update or overwrite existing tasks.

The preview flags matching titles (case-insensitive), original task IDs, and
repeated titles within the CSV. Existing archived tasks count as matches too.
Pending creation requests also count as matches. Possible duplicates start unchecked: leave them skipped or explicitly select them
to create separate tasks. Invalid rows stay excluded; correct the file and preview
again. Duplicate checks run again inside the creation transaction to catch tasks
created after the preview. Matching pending creation proposals are also skipped
at execution. Titles alone are a heuristic, so review flagged rows before choosing.

Import progress and row results distinguish created tasks, pending approvals,
skipped rows and failures. Confirming the import saves a browser recovery copy,
then uploads bounded, resumable chunks. The floating lemon shows uploading, queued,
and processing stages across navigation and refresh. Once queued, the server
continues even if the browser is closed. Use the lemon panel to download the
results CSV or retry unfinished rows. Retries reuse creation keys, including when the server
committed a task but its response was lost. Preview tickets are signed, tied to
the importer and expire after 24 hours. Preview again after expiry. Permissions,
maintenance, fields and approval policy are rechecked for every imported row.

The JSON endpoints are `POST /api/v1/boards/import/preview` with
`{boardId,csv,mapping:[{column:0,target:"name"}]}` and
`POST /api/v1/boards/import/row` with `{token,allowDuplicate:false}`. Column indices
are zero-based. Destinations are `name`, `description`, `status`, `priority`,
`due_date`, `group`, `assignees`, `checklist`, `source_id`, or an active custom
field ID. `source_id` is only a duplicate-check hint; new tasks receive UUIDv7 IDs.
Both endpoints require a current session, board access and the configured same
origin. CSV contents and preview tickets are not stored as uploaded attachments.

## Persistent CSV transfers

`docker compose up -d --build worker` runs the Node.js/TypeScript worker in Docker.
It uses pg-boss queues in PostgreSQL's `pgboss` schema; Redis remains the realtime
transport. For a host-run worker, use `pnpm worker` with the same `.env` as the app.
Apply `pnpm db:deploy` before processing transfers. Worker health is checked on its
private port 3002; no worker API is exposed to the browser.

The worker processes at most two CSV jobs per instance and one per board across
instances. Imports create tasks or proposals through the ordinary domain rules.
Each successful row and its task/proposal commit in the same transaction. Saved
checkpoints, stable creation keys, retries with backoff, heartbeats, and a durable
enqueue handoff let a restarted worker resume without duplicating accepted rows.
Cancelling stops between rows; rows already committed remain on the board.

Private normalized import chunks and completed exports are stored under
`csv-jobs/` in SeaweedFS, separately from task attachments. LOCAL storage remains
available for tests; host workers must share `YUZU_UPLOAD_DIR` with the web app.
The queue carries job IDs, not CSV contents. Each user can have three active
transfers and create up to 100 per day. Import staging is bounded to 80 MB after
normalization, in addition to the existing 25 MB CSV and 25,000-row limits.

Socket.IO invalidates the owner's transfer query when progress changes; a
five-second active-job reconciliation recovers missed events. Zustand owns only
panel visibility. Every transfer action and download rechecks ownership and
current board access. The worker rechecks current access, maintenance, fields,
and approval policy during processing without storing session cookies.

The browser recovery copy uses IndexedDB and is removed after the handoff or
cancellation. Refreshing during upload resumes missing chunks when that same
account opens the workspace again. Uploads cannot transmit while the browser is
closed, and clearing browser data/private-session storage removes that recovery
copy. Drafts and preview tickets expire after 24 hours. Preview/mapping changes
before confirmation are not saved as background jobs.

Completed files and result reports expire after 24 hours. The worker periodically
removes expired transfer objects and reclaims orphaned objects after 48 hours.
Downloads use the shared runtime and a non-dismissible progress toast, so normal
page navigation keeps the transfer running. A browser download itself may be
interrupted by refresh; the prepared file can be
downloaded again until expiry. Back up both PostgreSQL (including `pgboss`) and
SeaweedFS. The existing synchronous export/row endpoints remain for integrations;
the app uses `POST /api/v1/transfers`, per-transfer upload/action endpoints, and
owner-scoped GET status, download, and result-report endpoints.

## Large boards

Board and Table views request 100 tasks at a time. Search (task name or
description), status, assignment, priority, dates, groups, archive filtering,
and sorting run in PostgreSQL across the entire board before paging. The footer
shows the filtered total and page controls; status counts include matches on all
pages. A status with matches elsewhere offers a shortcut to filter that status.
Long lanes and tables render only the visible rows. Task links load their task
independently of the current page or saved filter.

Run `pnpm db:deploy` after updating. The board-query migration installs PostgreSQL
`pg_trgm` for indexed substring search and adds compound board/date indexes. Your
migration database account needs permission to install that extension. This is
available in the bundled PostgreSQL container.

## Workspace task search

The header search finds tasks by name or description across all accessible
boards. Results show their workspace and board, open the task sheet directly,
and load 20 at a time with stable cursor pagination. Archived tasks have a
separate search toggle. Workspace membership and the current role are checked
on every request, including additional result pages. Pending approval drafts
are excluded. Search updates when board events arrive, when reopened, and on
window focus/reconnect.

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
