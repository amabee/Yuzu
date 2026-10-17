# Yuzu development handoff

Snapshot: 2026-10-17 (Asia/Singapore). Read this before older progress notes.
Verify live Git, process, and Docker state when resuming; this is a snapshot.

## Where we are

Yuzu is a self-hosted work-management app, initially for a small internal team.
The user plans to run it on their computer first, then a shared server. Board
work came before automation. The latest Phase 3 batch is implemented and merged:
CSV exchange/background transfers, large-board performance, cross-board task
search, and basic overview reporting. The application remains pre-production.

Main baseline: `f8acb79`, merged through PR #8:
https://github.com/amabee/Yuzu/pull/8

The merged feature branches were `feat/large-board-performance`,
`feat/workspace-task-search`, and `feat/workspace-dashboards`, stacked on the CSV
branches. Main includes their final integration fixes and the earlier CSV work.
The source was verified unchanged between the tested feature tip and main.

At handoff, unrelated user work was present and intentionally preserved:

- Modified `.gitignore`.
- Untracked `apps/web/src/components/yuzu/fonts.ts`.

Do not discard or stage those automatically. `docs/` is locally ignored; this
handoff is explicitly requested and can be tracked with a targeted force-add.
The documentation handoff work uses `docs/development-context`; check Git for
its final commit/push state. Existing `apps/web/AGENTS.md` remains in force.

## Product decisions and completed capabilities

- Installation: resumable owner/workspace/board setup, working SMTP verification
  required before completion, invitations, password recovery and session controls.
  Mailpit is used for local email testing. Setup/welcome already have GSAP motion.
- Boards: Table/Kanban, full-card dragging plus handle, archive/restore, custom
  fields, configurable statuses/order/icons/colors, priority colors, colored tags,
  separate multi-select options, and independent per-task checklists.
- Task sheets: shadcn Sheet, comments/mentions/history, activity, files, stacked
  assignee avatars/tooltips, and editing with revision/conflict protection.
  Cards keep avatars bottom-left, comments bottom-right, and a short date by the
  title. Empty lanes use citrus artwork. Avoid restoring removed clutter.
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

Latest code validation: build/lint/types pass; 129 web unit tests pass. Across
the final browser run and its resumed segment, 74 distinct scenarios passed;
one S3-only migration scenario was skipped. The test web server stopped accepting
connections during Docker unpack; the remaining 23 scenarios passed after restart.
Regression fixes cover stale task copies, group usage outside the loaded page,
same-board task links, and ordinary-member live reporting. Desktop/light/dark and
390px mobile layouts were inspected. A 25,000-task seeded board was tested with
paging, literal search, virtualization, scrolling and native dragging. The exact
25 MB / 25,000-row preview and 300-task crash recovery were tested; this is **not**
a benchmark of writing all 25,000 tasks or sustained multi-user concurrency.

## Projects (in progress, 2026-10)

The user reprioritized Projects ahead of automation. Hierarchy: Organization
(the installation; reserved for a future page builder) → Workspace → Project
(optional, PUBLIC/PRIVATE) → Board → Groups → Items → Subitems. Standalone boards
remain. Views (kanban/table/calendar/timeline) are views of one board, not a
level. Spec: `docs/specs/projects.md` on branch `docs/projects-spec` (no PR yet).

- `feat/projects-data`, PR #10 (https://github.com/amabee/Yuzu/pull/10): schema,
  `/api/v1/projects/[action]`, and `boardScope`/`projectScope`/
  `visibleWorkspaceScope` in `server/team-access.ts`, used by every board read.
  Private projects are hidden from admins too; admins regain access only via
  audited `recover`. Outsiders join a project by invitation (`projectOnly`).
  Gotcha: Prisma matches nothing for `{}` inside `OR`, so the scopes return
  `{}` directly for admins.
- Next: `feat/projects-ui`, stacked on `feat/projects-data`: sidebar Projects and
  Boards groups, `/projects/[id]`, create/members/move/archive flows. Deferred
  from the data PR: realtime project-list hints, `projectName` in search and
  notifications, the dashboard project filter, and saved-view `layout`.
- After that: saved-view layouts, then the app redesign (mockups in
  `docs/mockups/app-redesign-*`).

## Next session

Continue the Projects work above. Phase 4 on the roadmap is
automation: triggers, conditions, actions, execution and monitoring. **Plan its
first slice with the user before coding**; its precise implementation scope has
not been approved. OpenAPI completion, remaining account/workspace lifecycle
administration, release deployment, backup/restore and pilot/load verification
also remain; do not describe Yuzu as production-ready or those as complete.

Start with this file, `git status`, and the specific source needed for the new
request. Consult `README.md` for operational detail and `docs/progress.md` only
when historical evidence is needed. Older notes saying CSV jobs require keeping
the board open, or that files/search/reporting are still unimplemented, are stale.
