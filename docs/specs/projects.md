# Projects: spec

Status: draft for review, 2026-10-18. Nothing implemented yet.

Adds a level between workspaces and boards:

```
Workspace  →  Project  →  Board  →  Task
```

A workspace is a team's space (who can see what). A project groups the boards
for one piece of work, such as "Yuzu 1.0" or "Marketing site". Projects are an
organizing level, not a new permission boundary in this first version.

## Goals

- Group boards by project in the sidebar, search, overview, and board header.
- Create, rename, recolor, reorder, archive, and restore projects.
- Move a board between projects in the same workspace.
- Keep every existing board working: no data loss, no broken links.

## Not in this version

- Per-project read access. Access stays workspace-wide (see Decisions).
- Moving boards across workspaces.
- Project templates, project-level fields, statuses, or approval policies.
- Board archive/rename/reorder beyond what moving needs. These are noted in
  "Related gaps" and can follow separately.

## Decisions (proposed; confirm in review)

| # | Question | Proposal | Why |
| - | -------- | -------- | --- |
| D1 | Does a project restrict who can see its boards? | No. Workspace membership still decides access. | `workspaceScope` drives boards, search, overview, notifications, and realtime. Changing it is a large security change; grouping alone gives most of the value now. |
| D2 | Who can create and manage projects? | Owners/admins, plus **project managers**. Creating a project makes you its manager. | Mirrors board managers; lets a team lead organize without being an admin. |
| D3 | Who can create a board in a project? | Owners/admins and that project's managers. | Today any board manager in the workspace can create boards. Scoping this to the project is the natural tightening. Existing board managers get project-manager rights on the migrated default project, so nobody loses ability. |
| D4 | Must every board belong to a project? | Yes, `Board.projectId` is required. | No "loose boards" state to design, query, or explain. |
| D5 | What happens to existing boards? | Each workspace gets one project, "General", holding all its boards. | Safe, reversible grouping; owners can rename and split it later. |
| D6 | Archiving a project | Archives the project only. Its boards stay intact but are hidden from navigation and lists, and are read-only while archived. Restore brings everything back. | No cascading writes to tasks; one flag to check. |
| D7 | Deleting a project | Not offered. Archive only. | Matches the app's archive-first approach to records. |

## Data model (packages/database)

New table:

```prisma
model Project {
  id          String    @id @default(uuid(7)) @db.Uuid
  workspaceId String    @db.Uuid
  name        String                       // 1–80 chars, trimmed
  color       String                       // token key from a fixed palette, not raw hex
  position    Int                          // order within the workspace
  archivedAt  DateTime?
  createdById String    @db.Uuid
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt
  revision    Int       @default(1)        // optimistic concurrency, like tasks

  workspace Workspace        @relation(fields: [workspaceId], references: [id], onDelete: Restrict)
  createdBy User             @relation(fields: [createdById], references: [id], onDelete: Restrict)
  boards    Board[]
  managers  ProjectManager[]

  @@unique([workspaceId, name])
  @@index([workspaceId, archivedAt, position])
}

model ProjectManager {
  projectId   String   @db.Uuid
  userId      String   @db.Uuid
  grantedById String   @db.Uuid
  createdAt   DateTime @default(now())
  project Project @relation(fields: [projectId], references: [id], onDelete: Cascade)
  user    User    @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@id([projectId, userId])
}
```

`Board` gains:

```prisma
  projectId String @db.Uuid
  position  Int    @default(0)               // order inside the project
  project   Project @relation(fields: [projectId], references: [id], onDelete: Restrict)
  @@index([projectId, position])
```

- IDs from `createRecordId()` as usual.
- `Board.workspaceId` stays, denormalized, so the many queries using it keep
  working. An invariant check (and the move service) keeps it equal to
  `project.workspaceId`.
- `InstallationSettings` gains `initialProjectId` alongside the existing initial
  workspace/board ids.

### Migration (one migration, three steps, in a transaction)

1. Create `Project` and `ProjectManager`. Add `Board.projectId` (nullable) and
   `Board.position`.
2. For each workspace: insert a "General" project (UUIDv7 generated in SQL via the
   existing helper, or a TS data step like `upgrade-ids.ts`). Set every board's
   `projectId` to it, and set `position` from `createdAt` order. Copy every
   distinct `BoardManager.userId` in that workspace into `ProjectManager`.
3. Make `Board.projectId` NOT NULL and add the FK and indexes.

Rehearse on a copy of the dev database. Never reset the development database.

## Permissions (apps/web/src/server)

- `workspaceScope(user)` is unchanged (D1).
- New `projectScope(user)`: `{ workspace: workspaceScope(user) }` plus
  `archivedAt: null` for navigation. Archived projects load only on the
  "Archived" view or for admins and managers.
- New `projectAccess(tx, userId, projectId, write)`, modelled on board `access()`:
  loads through `projectScope` and returns `canManage = admin || ProjectManager`.
- Board `access()` additionally rejects writes when the board's project is
  archived (D6) with the existing forbidden error shape.
- `manageBoard("create-board")` takes `projectId` instead of `workspaceId`
  and requires `projectAccess(..., write).canManage` (D3).
- Every check runs on the server. Hidden UI is never the guard.

## API

New `app/api/v1/projects/[action]/route.ts`, following the boards route pattern
(validated body, `requireIdentity`, serializable transaction, bounded payloads):

| Action | Method | Who | Notes |
| ------ | ------ | --- | ----- |
| `list` | GET | members | Projects with their boards (id, name, color, position), ≤ 200 projects. `?archived=1` for the archive view. |
| `create` | POST | admin, or manager of any project in the workspace | Name and color; appended to the end. The creator becomes manager. |
| `update` | POST | admin, project manager | Rename or recolor; `revision` required, conflict on mismatch. |
| `reorder` | POST | admin | Full ordered id list for one workspace; validated as a permutation. |
| `archive` / `restore` | POST | admin, project manager | Sets/clears `archivedAt`. |
| `manager` | POST | admin, project manager | Grant or revoke. Never removes the last manager, unless an admin acts. |
| `move-board` | POST | admin, or managers of both projects | Same workspace only. Updates `projectId` and `position`; writes a `BoardEvent`. |

Contracts live in `lib/project-contract.ts` (zod), like the board contracts.

## Cross-cutting changes

- **Layout and sidebar data** (`(workspace)/layout.tsx`): load projects with
  their boards ordered by position: `workspaces → projects → boards`.
- **Search** (`task-search-service.ts`): return `projectName` next to
  `workspaceName`. The filter is unchanged.
- **Overview** (`dashboard-service.ts`): optional `projectId` filter next to
  `workspaceId`. Board report rows include the project. The query key becomes
  `["principal", id, "dashboard", workspaceId, projectId, page]`.
- **Notifications:** include the project name in the context line. Scoping is
  unchanged.
- **Realtime:** project create/update/archive/move publishes a workspace-level hint
  to members using the existing per-user fan-out (as overview hints do). Clients
  invalidate a new `["principal", id, "projects", workspaceId]` key. No new rooms.
- **Setup** (`completeSetup`): create workspace → project → board in the same
  transaction and set `initialProjectId`. The wizard step "Workspace & board"
  becomes "Workspace, project & board" with a project name field (default
  "First project").
- **CSV import/export:** unaffected. Both are board-scoped.

## UI

Built in the redesign shell (see `docs/mockups/app-redesign-board.html`), using
the shadcn `Sidebar` already in the app and new shadcn Dialog, DropdownMenu, and
Popover components.

### Sidebar, "Projects" group

```
Projects                         [+]
 ▾ [Y] Yuzu 1.0
     • Q4 Launch          ← active board
     • Design system
     • Bug triage
     + New board
 ▸ [P] People ops
 ▸ [M] Marketing site
```

- `SidebarGroup` labelled "Projects", plus a `SidebarGroupAction` (+) for managers.
- Each project is a `Collapsible` `SidebarMenuItem`. The badge is the project
  initial on its color, from the theme palette tokens, never hardcoded hex.
  Open/closed state is remembered per user in localStorage, and the active
  board's project always opens.
- Boards are `SidebarMenuSub` items with their color dot. "New board" appears
  only for people who can create boards there.
- Item menu (`SidebarMenuAction`, shown on hover and focus): Rename, Change color,
  Move up/down (admins), Archive. Every action works by keyboard, with no
  drag-only reordering.
- Icon-collapsed sidebar: projects show their badge with a tooltip, and clicking
  opens a popover listing the boards.

### Project page `/projects/[id]`

```
Yuzu 1.0                                   [Manage ▾] [+ New board]
3 boards, 41 open tasks, 3 overdue
┌──────────────────────────────────────────────────────────────┐
│ Q4 Launch       ███████░░░  46% done   22 tasks   JP SC MR   │
│ Design system   █████████░  62% done   14 tasks   SC AN      │
│ Bug triage      ████░░░░░░  30% done   31 tasks   LK JP      │
└──────────────────────────────────────────────────────────────┘
Deadlines this week                    Waiting on approval
```

- One list of boards, not a card grid. Board rows reuse the Overview's
  progress-bar treatment so the two pages feel related.
- The summary line uses the dashboard service with the `projectId` filter, so
  the numbers match the Overview.
- The board header breadcrumb becomes Project › Board, and the project is a link.

### Flows and copy

- **Create project:** Dialog with "Project name" and a color picker (8 palette
  swatches, each with a visible name for accessibility). Button: "Create project".
  Toast: "Project created". Lands on the new, empty project page.
- **Empty project:** citrus artwork, "No boards in this project yet", and the
  primary button "New board" (or, for non-managers, "Ask a project manager to
  add a board.").
- **Move board:** in the board's ⋯ menu, "Move to project…" opens a searchable
  list of projects in the same workspace. Button: "Move board". Toast: "Moved to
  Yuzu 1.0". The board URL does not change, so links keep working.
- **Archive project:** a confirm dialog with the real consequence: "Archive Yuzu
  1.0? Its 3 boards will be hidden and read-only until you restore it. Nothing is
  deleted." Button: "Archive project". Toast: "Project archived" with a "Restore"
  action.
- **Archived view:** Settings › Projects lists archived projects with "Restore".

### Accessibility and motion

- Collapsibles use the Radix `Collapsible` with correct `aria-expanded`.
- Dialogs trap and return focus. Toasts follow the existing dismissal rules.
- Only motion that answers an action: collapsible height and the toast. No GSAP
  needed here. Reduced motion is respected.

## Testing

- **Unit:** `project-contract` validation; reorder permutation check;
  `projectAccess` matrix (admin / manager / member / non-member / archived);
  move-board same-workspace rule.
- **Migration:** run against a snapshot with several workspaces and boards. Every
  board gets a project, manager rows are copied, counts are unchanged.
- **E2E (`installation.spec.ts` + new `projects.spec.ts`):** setup creates
  workspace, project, and board. Then create a project, create a board in it,
  move a board, archive (board becomes read-only) and restore, and keyboard-only
  sidebar navigation.

## Rollout

Separate branches, in order:

1. `feat/projects-data`: schema, migration, `projectAccess`, contracts, API,
   setup change, unit tests. The UI still shows the old sidebar, using project
   data underneath.
2. `feat/projects-ui`: sidebar group, project page, dialogs, breadcrumb, search
   and overview labels, e2e.
3. Then the app redesign phases, which build on this.

Update `docs/DEVELOPMENT_CONTEXT.md` after each phase.

## Related gaps found while writing this

- Boards cannot be renamed or archived today. Rename/archive board is a small,
  separate follow-up that would pair well with phase 2.
- Workspaces can't be created after setup. Out of scope here; worth its own spec.

## Open questions for review

1. D1: is workspace-wide access acceptable for now, or do you need private
   projects soon? Private projects change scoping across search, overview,
   notifications, and realtime, and would need their own spec.
2. D3: is it right that creating a board requires being a project manager, given
   that today any board manager in the workspace can?
3. D5: is "General" the right name for the migrated project?
