# Yuzu development handoff

Snapshot: 2026-10-19, end of day (Asia/Singapore). Read this before older progress notes.
Verify live Git, process, and Docker state when resuming; this is a snapshot.

## Where we are

Yuzu is a self-hosted work-management app, initially for a small internal team.
The user plans to run it on their computer first, then a shared server. Phases
1–3 are merged, plus Projects, saved-view layouts, Calendar/Timeline, task start
dates, the app redesign, the "pause point" design system, the task panel, the
Kanban redesign and the notification bell dropdown. **Phase 4 (automation)
slices 1 and 2 are merged.** The application remains pre-production.

Main: merge of PR #25 (`b66dfbe`). Recent PRs: #20 finish-up pass (pause style
everywhere, bell dropdown, no theme switcher on sign-in/welcome), #21 automation
engine, #22 Kanban hydration fix, #23 automations UI, #24 automation slice 2
engine, #25 slice 2 builder, custom notification messages and the rule
notification visibility fix.

Unrelated local modifications are usually present in the working tree (many
files show CRLF-only churn). Stage only files with real changes
(`git diff --ignore-cr-at-eol`), never `git add -A`. `docs/` is locally ignored;
force-add only an explicitly requested document. Do not add Claude attribution to
commits or PR bodies. Existing `apps/web/AGENTS.md` remains in force.

## Product decisions and completed capabilities

- Installation: resumable owner/workspace/board setup, working SMTP verification
  required before completion, invitations, password recovery and session controls.
  Mailpit is used for local email testing. Setup/welcome already have GSAP motion.
- Boards: Kanban/Table/Calendar/Timeline layouts per saved view
  (`config.layout`; Timeline adds `config.timeline {groupBy, zoom}`), custom
  fields, configurable statuses/order/icons/colors, priority colors, colored tags,
  multi-select options and per-task checklists. Every task has an optional start
  date (`startDate <= dueDate` is a DB check). Week start is an installation
  setting.
- Kanban (`components/boards/board-kanban.tsx`): dnd-kit drag and drop (mouse,
  touch long-press, keyboard) with GSAP lift/lean/settle, off for reduced motion.
  Tasks keep a manual `position` (Float, backfilled from creation order; new
  tasks append). `POST /api/v1/boards/reorder {taskId, afterId, beforeId}` needs
  edit access but skips revisions, approvals and activity, and respaces the board
  when neighbours get too close. The default "created" sort means manual order;
  name/due sorts only allow moving between lanes. Status changes still go through
  the normal update/approval path. Playwright drags need `dragTo(..., { steps })`.
  The board pulse (`board-pulse.tsx`) shows whole-board status counts and overdue
  from `state.pulse`, ignoring filters; it replaced the bottom "Project overview".
- Task panel (`task-editor.tsx` inside a `task-panel` sheet): breadcrumb row with
  copy link / archive / more menu (Mark as done, Task editors modal), status pill,
  editable title, creator avatar, click-to-edit property rows, a pending-request
  card, description, checklist, then Comments/Activity/Files with the comment
  composer portalled into the footer. A save bar appears only with edits or
  conflicts.
- Pause points (`components/pause/`): the user's alert/dialog/modal design.
  `PauseAlert`, `PauseDialog`, `PauseModal`, `PauseButton`, `PauseClose`, and
  `PauseSheetDecor` for side sheets (`pause-sheet` + `pause-sheet-body`). Leaf and
  lemon artwork are the toast's (`/toasts/yuzu-leaf-corner.svg`,
  `yuzu-lemon-slice.svg`). Intent colors are fixed tokens (`--intent-*`), cream
  `--pending` marks approvals.
- Notifications: the header bell opens a dropdown (All/Unread, mark all read,
  latest 8, link to the Inbox page). Rule notifications (`AUTOMATION`) are whole
  sentences and visible to every recipient, not only managers.
- Automation (Phase 4, spec `docs/specs/automation.md`): per-board When / If /
  Then rules built from Board → Automations (managers only). See the section
  below.
- Permissions: workspace-scoped access, creator/assignee/explicit editor writes,
  scoped board managers, owners/admins managing global access. A People custom
  field does not grant task editing permission.
- Approvals: configurable toggles for protected operations/fields, one independent
  approver, primary/backup routing, no self-approval, private requests/decisions.
  Accepted records change only after approval where policy requires it.
- Appearance: Yuzu theme editor with presets, typography and surface controls;
  global owner/admin publication, personal light/dark/system mode. Shadcn sidebar,
  theme ripple switch and theme-colored nextjs-toploader are integrated.
- Feedback/recovery: citrus toasts with animated leaves; normal notices dismiss
  automatically. Active upload/download progress is non-dismissible. Error,
  unauthorized, forbidden, rate-limit, maintenance and offline recovery are wired.
- Storage: private SeaweedFS S3-compatible attachments and CSV objects. Attachment
  policy defaults to 50 MB; settings and server validation remain authoritative.
  Uploads continue when closing/switching task sheets; do not confuse this with
  the stronger durable CSV navigation/refresh guarantees below.

## Current Phase 3 behavior and limits

| Area              | Implementation                                                                                                                                                                                       |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Board loading     | Database search/filter/sort, 100-task pages, whole-filter totals/status counts, TanStack Virtual for long lanes/tables. Task links load independently of the page.                                   |
| Cache consistency | Successful saves publish canonical task/metadata to cached page copies. Keep their own page membership/totals; never downgrade newer revisions. Inline moves update copies too.                      |
| Group removal     | Usage counts include every page and archived tasks. Server removal additionally checks pending requests and concurrent assignments.                                                                  |
| Header search     | Task name/description across authorized boards; debounced, 20-result cursor pages, archive toggle, direct task links. Recheck access on every page.                                                  |
| Overview          | Whole-scope counts, workspace filter, 12-board report pages, 10-task deadline lists and top 12 assignees. Shared tasks count once overall and per person in workload.                                |
| Completion        | Stable built-in status ID `done`, even if renamed, matches the task-sheet completion action. Custom statuses remain open. This limitation is explicit in the UI.                                     |
| Dates             | Installation timezone; overdue precedes today, upcoming includes today through seven days ahead. Reports exclude archived tasks and pending drafts.                                                  |
| Realtime          | Self-hosted Socket.IO with Redis adapter; signed short-lived board/user tickets. Hints invalidate queries; authoritative reads still authorize. Workspace members receive overview/search hints too. |
| Reconciliation    | Board sync uses 60 seconds when live / 15-second fallback. Overview reconciles every 60 seconds when visible and on focus/reconnect. No routine full-page reloads.                                   |
| CSV import        | 25,000,000 bytes / 25,000 rows. Bounded previews: 1,000,000 bytes / 500 rows per request; preview UI pages 100 rows. Flag duplicates for skip/create, never overwrite existing tasks.                |
| CSV export        | Current-view export bounded to 10,000 tasks / 10,000,000 bytes. Formula safety and typed values are preserved.                                                                                       |

CSV jobs use pg-boss in PostgreSQL's `pgboss` schema and the separate Docker
worker: two jobs per worker, one per board globally. Import/proposal creation and
row checkpoints commit atomically with idempotent creation keys. Confirmed inputs
stage as private normalized chunks in SeaweedFS; IndexedDB resumes an interrupted
handoff for the same browser/account. The shared floating lemon panel restores
status after navigation/refresh and supports results, retry, stop and downloads.

An upload cannot transmit while the browser is closed; clearing browser storage
loses the not-yet-handed-off recovery copy. Preview/mapping before confirmation is
not a durable job. Refresh can interrupt actual browser file delivery; prepared
exports/results can be downloaded again for 24 hours. Active jobs expire after
seven days; worker cleanup also reclaims expired/orphan objects. No session
cookies are embedded in jobs; current permissions/policy are rechecked.

## Stack, source map, and local runtime

Node 24, pnpm 11.9.0, Next 16.4 App Router, React 19.3, TypeScript, Tailwind 4,
shadcn/Radix, TanStack Query/Virtual, Zustand, GSAP, Better Auth, Prisma 7.10,
PostgreSQL 17, Socket.IO/Redis, SeaweedFS, Mailpit and pg-boss.

| Path                                                                      | Purpose                                                                              |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `apps/web/src/app/(workspace)`                                            | Workspace routes/layout; overview and boards.                                        |
| `apps/web/src/app/api/v1`                                                 | Validated/authenticated feature endpoints.                                           |
| `apps/web/src/server/board-service.ts`                                    | Board access, state, task writes, fields/groups, comments.                           |
| `apps/web/src/server/team-access.ts`                                      | Current identity, administrator checks, workspace scope.                             |
| `apps/web/src/server/approval-*.ts`                                       | Approval policy and transaction handling.                                            |
| `apps/web/src/components/boards`                                          | Board surface, task sheet, management, fields, files and live sync.                  |
| `apps/web/src/lib/board-cache.ts`, `task-sync.ts`, `server/task-query.ts` | Shared cache updates, draft/conflict reconciliation, database task predicates/order. |
| `server/task-search-service.ts`, `components/workspace-search.tsx`        | Cross-board search (paths relative to `apps/web/src`).                               |
| `server/dashboard-service.ts`, `components/dashboard`                     | Overview aggregates and UI.                                                          |
| `server/csv-*.ts`, `components/transfers/csv-transfer-runtime.tsx`        | CSV validation, staging, durable execution and shared lemon runtime.                 |
| `apps/worker`, `apps/realtime`, `packages/realtime-protocol`              | Worker entrypoint, websocket service and signed message contracts.                   |
| `packages/database`                                                       | Prisma schema/migrations, UUIDv7 factory, storage objects and maintenance commands.  |
| `apps/web/tests/installation.spec.ts`                                     | End-to-end feature coverage and isolated fixtures.                                   |

Local endpoints (verify Compose/env overrides): app `http://127.0.0.1:3000`,
PostgreSQL `127.0.0.1:54329` (HeidiSQL can connect), Mailpit UI `:8025` / SMTP
`:1025`, Socket.IO `:3001`, SeaweedFS S3 `:8333`, admin console `:23646`.
The worker health endpoint is container-local `:3002`. Credentials and keys belong
in `.env`; never copy them into this document. At the last check, app readiness
returned 200 and the rebuilt/recreated Docker worker was healthy.

## Commands and verification

```powershell
pnpm install --frozen-lockfile
pnpm services:up
pnpm db:generate
pnpm db:deploy
pnpm db:check
pnpm dev

pnpm check
pnpm test:e2e
docker compose up -d --build --wait worker
```

Only for a brand-new environment: copy `.env.example` to `.env`, then run
`pnpm setup:keys` before starting services. Do not overwrite an existing `.env`
or rotate its keys casually. The latest board-query migration installs `pg_trgm`
and compound indexes; the migration account needs extension-install permission.

`pnpm check` runs formatting, lint, generation/type checks, tests and build.
Focused web commands: `pnpm --filter @yuzu/web lint`, `test`, `build`, or
`exec tsc --noEmit`. Worker/database have their own `typecheck` scripts.
Build before production Playwright. Tests use isolated `yuzu_e2e`, web `:3100`,
realtime `:3101`, worker `:3102`, and SMTP `:25250`; fixtures reset test data.
`YUZU_E2E_S3=1` enables the isolated SeaweedFS test bucket; Redis multi-instance
tests require `YUZU_TEST_REDIS_URL`. Keep Docker builds separate from browser runs.

Latest code validation (2026-10-19, `feat/automation-slice2-ui`): build, lint
and types pass; 167 web unit tests pass; all 8 automation browser tests and the
notification/Inbox tests pass. The last full browser run (slice 2 engine) was
92 passed / 1 skipped; the user stopped the full run on the final UI commit, so
it was not rerun there. A 25,000-task seeded board is covered for paging,
search, virtualization and dragging; this is **not** a benchmark of sustained
multi-user concurrency. Orphaned test servers on `:3101` can block a rerun; stop
only that test port, never the dev services.

## Projects (merged)

Hierarchy: Organization (the installation; reserved for a future page builder) →
Workspace → Project (optional, PUBLIC/PRIVATE) → Board → Groups → Items.
Standalone boards remain. Views are views of one board, not a level. Spec:
`docs/specs/projects.md`. `boardScope`/`projectScope`/`visibleWorkspaceScope` in
`server/team-access.ts` gate every board read. Private projects are hidden from
admins too; admins regain access only via audited `recover`. Gotcha: Prisma
matches nothing for `{}` inside `OR`, so the scopes return `{}` directly for
admins. Navigation changes publish a data-free `kind: "navigation"` realtime hint.

## Automation (merged)

Rules are rows in `AutomationRule` (trigger, `match`, conditions, actions JSON).
Task writes queue `AutomationEvent` rows in the same transaction, only on boards
with an enabled rule. The worker (`server/automation-service.ts`, started from
`apps/worker`) polls every 2 s, runs matching rules as their creator through the
normal task write path, and records `AutomationRun` history (30 days).

- Decisions: managers build rules; rules run as their creator and pause if that
  person loses access; approval-protected changes become approval requests;
  chains stop at depth 3 with no self-retrigger; 5 failures in a row pause a
  rule and notify its creator.
- Triggers: task created, status changed, assigned, due today, overdue, field
  changed, schedule (day/weekday/week/month at a time, installation timezone;
  a missed time runs once within 24 h), comment added, checklist completed.
- Actions: set status/priority/group/fields/dates, assign/unassign, notify
  (custom message with `{task}`/`${task}` placeholders, optional "replace Yuzu's
  own notification"), create a task (here or on a board the creator manages),
  webhook (owners/admins; HMAC-signed, secret shown once, encrypted with
  `SETTINGS_ENCRYPTION_KEY`, 3 retries; private-network URLs refused unless the
  admin setting "Allow local-network webhooks" is on).
- Pure logic lives in `lib/automation-{contract,engine,schedule,describe,message}.ts`
  with unit tests; browser coverage is `tests/automation.spec.ts`.
- Operations: the Docker worker must run the same code as the app and needs
  `SETTINGS_ENCRYPTION_KEY` (now in `compose.yaml`). After pulling, run
  `docker compose up -d --build --wait worker`. A worker older than a saved rule
  reports "options the worker doesn't recognise" in run history.

## Next session

The user's agreed order (2026-10-19): **email next**, then admin + API
(account/workspace lifecycle administration, OpenAPI). Go-live work
(deployment, backup/restore, pilot/load verification) is deferred until asked.

Email was only proposed, not planned. Plan it with the user before any code, as
was done for automation: notification emails per type with instant / daily
digest / off settings and unsubscribe links, a timezone-aware daily digest, no
email for your own actions or for notifications already read in the app, an
"email" rule action reusing custom messages, and branded HTML plus plain-text
templates. It builds on the existing SMTP setup (Mailpit locally).

Small leftovers: the theme switcher still shows on setup, invitation and
password-reset pages (the user only asked to remove it from sign-in/welcome).
Do not describe Yuzu as production-ready.

Start with this file, `git status`, and the specific source needed for the new
request. Consult `README.md` for operational detail and `docs/progress.md` only
when historical evidence is needed. Older notes saying CSV jobs require keeping
the board open, or that files/search/reporting are still unimplemented, are stale.
