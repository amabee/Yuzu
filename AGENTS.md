# Working on Yuzu

## Start here

- Read `docs/DEVELOPMENT_CONTEXT.md` for the current handoff. Check `git status`
  and the current branch before changing files. Verify snapshot details in code.
- Read only the relevant feature documentation; do not load the entire chat
  history or `docs/progress.md` by default. Older documents describe earlier
  implementations and may be superseded by the handoff or current source.
- Follow `apps/web/AGENTS.md` when working in the web app. Before changing Next.js
  code, read the relevant installed documentation under
  `apps/web/node_modules/next/dist/docs/`. This repository uses Next.js 16.4.

## User preferences

- Keep communication concise. Complete the requested work and explain material
  findings; avoid repeated confirmation requests for already authorized work.
- Use a separate descriptive branch per feature/fix, such as `feat/...`,
  `fix/...`, or `docs/...`. **Do not use a `codex/` prefix.**
- Commit and push completed work after appropriate checks. Explain dependencies
  if branches are stacked. Merge into `main` when requested; GitHub requires a PR.
- Preserve unrelated local changes and never include them in a commit by accident.
- Plan substantial new product behavior before implementing it. Do not infer
  permission to implement the entire remaining roadmap from a status question.

## Implementation conventions

- Use Node.js 24 and pnpm 11.9.0; retain the lockfile and existing pinned versions.
- Use shadcn/Radix UI, TanStack Query for server requests/cache, and Zustand for
  client UI state. Do not copy server records into a competing Zustand store.
- Preserve dynamic theme tokens, configurable typography, and personal color
  mode. Owners/admins publish global themes; light/dark/system remains personal.
  Avoid hardcoded brand palettes or fonts. Use the installed frontend-design
  skill for substantial visual work. GSAP is the animation library; preserve
  existing welcome/setup animations and reduced-motion support.
- Use `createRecordId()` from `@yuzu/database` (or its `/ids` export in client
  code) for UUIDv7 records. Secret tokens and idempotency keys have separate roles.
- Enforce current identity, workspace access, write permissions, maintenance,
  revisions, reference validation, and approval policy on the server. Client UI
  checks never substitute for authorization. Keep resource reads scoped too.
- Keep task changes and their activity/approval/checkpoint records atomic. Preserve
  idempotency and bounded serialization-conflict retries. Never silently overwrite
  another person's conflicting edits or bypass approval requirements.
- Scope authenticated query keys by principal. Board keys also include board,
  filter, page, and focused task. Keep shared task/metadata copies consistent via
  the existing board-cache helper; preserve each page's membership and totals.
- Use existing Socket.IO invalidation and TanStack refresh patterns. Routine data
  changes must appear without a page reload. Keep background CSV transfers in the
  shared runtime/worker, independent of task sheets and route lifetimes.
- Keep database queries, API payloads, and rendered lists bounded. Whole-board
  totals and group-usage checks must not depend on the currently loaded page.
- Preserve accessible keyboard controls, focus behavior, avatar tooltips, toast
  progress/dismissal rules, and mobile layouts when touching the task UI.

## Verification and local safety

- See the handoff for commands and test ports. Run checks relevant to the change;
  documentation-only edits need formatting/review, not the whole browser suite.
- Browser tests reset **only** `yuzu_e2e`. Never reset/truncate the development
  database, remove Docker volumes, or regenerate existing secrets without a
  specific user request. Never print or commit `.env` contents or credentials.
- Generate Prisma after schema changes and add/apply migrations. Do not edit
  generated Prisma output. Preserve existing local installation/account data.
- Build the production app before production Playwright tests. Do not rebuild
  `.next` or edit running test specifications during a browser run. Run heavy
  Docker builds separately from browser tests; concurrent image unpacking has
  disrupted the local test server.
- PowerShell paths containing `[id]` require `-LiteralPath` when appropriate;
  quote paths containing `(workspace)`. For Python scripts use `python -X utf8`.
- `docs/` is currently ignored locally. Read it normally; do not change unrelated
  ignore rules. If explicitly committing a requested document, force-add only
  that specific file, not the whole directory.
- Keep this file short and durable. Put changing project state and follow-up
  details in `docs/DEVELOPMENT_CONTEXT.md`, updating it after substantial work.
