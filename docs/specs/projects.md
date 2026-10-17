# Projects: spec

Status: draft v2 for review, 2026-10-18. Nothing implemented yet.
v2 changes: standalone boards, public/private projects, the full hierarchy, and
views defined as a board property rather than a level.

## Hierarchy

```
Organization   the business using Yuzu (one per deployment)
└─ Workspace   a team, department, or major area of work
   ├─ Project  a specific initiative, goal, or body of work (public or private)
   │  └─ Board
   └─ Board    standalone boards live directly in a workspace
      └─ Groups → Items → Subitems
```

- **Organization** is the installation. Yuzu is deployed per client (single
  tenant), so there is exactly one, and `InstallationSettings` already holds its
  name. No new table now. The name "Organization" is reserved for it in the UI and
  code (e.g. `organizationName`) so later features such as a page or site builder
  for the client's public front page attach to it without a migration.
- **Workspace**: unchanged.
- **Project**: new. Optional; groups boards and can be **private**.
- **Board**: either in a project or standalone in its workspace.
- **Groups → Items → Subitems**: today these are BoardGroup → Task → checklist.
  Real subitems (child tasks with their own fields) are a separate spec. This one
  only makes sure nothing blocks them.

### Views are not a level

Kanban, Table, Calendar, and Timeline are different ways to look at the same
board. They are never separate boards, and never a sidebar level.

- A board owns its tasks once. A view only chooses layout, filters, sort, and
  grouping. `SavedBoardView` gains `layout: TABLE | KANBAN | CALENDAR | TIMELINE`.
  Calendar and Timeline layouts are follow-up work; the enum lands now so saved
  views don't need another migration.
- URL: `/boards/[id]?view=<savedViewId>` or `?layout=kanban`. The board id stays
  the same across views.

### Cross-cutting features span levels

Dashboards, automations, and later CRM records query across projects and boards.
They never live "inside" one level. They all use the same access filter
(`boardScope`, below), so a private project's data never leaks into a dashboard or
automation run by someone outside it.

## Goals

- Create public and private projects; add/remove project members and managers.
- Boards can be created in a project or standalone; move boards between a
  project and standalone (same workspace).
- Private project boards, tasks, comments, files, notifications, search results,
  dashboard numbers, approvals, and realtime events are invisible to non-members.
- Rename, recolor, reorder, archive, and restore projects.
- Existing data keeps working with no broken links.

## Not in this version

- A database table for Organization (see above).
- Private standalone boards. Privacy is a project property; put a board in a
  private project to make it private.
- Moving boards across workspaces.
- Calendar and Timeline layouts (only the `layout` field lands).
- Subitems, automations, CRM.

## Decisions (proposed; confirm in review)

| # | Question | Proposal |
| - | -------- | -------- |
| D1 | Who sees a **public** project? | Every member of its workspace, as boards work today. |
| D2 | Who sees a **private** project? | Its project members, plus owners/admins. Admins can see private projects so the deployment's operators can always recover access. |
| D3 | Project roles | `MANAGER` (settings, members, create boards) and `MEMBER` (normal board work). The creator becomes manager. |
| D4 | Must a board belong to a project? | No. `Board.projectId` is nullable; null means standalone. |
| D5 | Existing boards after migration | They stay standalone. No data is moved. |
| D6 | Who creates standalone boards? | Unchanged from today: admins and existing board managers in the workspace. |
| D7 | Who creates boards in a project? | Admins and that project's managers. |
| D8 | Making a public project private | Allowed for managers. Before saving, the dialog lists how many current viewers will lose access. Their open task sheets close on the next sync, and their notifications from it are hidden. |
| D9 | Removing someone from a private project | They lose access at once (server checks run on every read). Assignments stay for history but show "No longer has access". Pending approvals they must decide are rerouted to the backup approver, per the existing routing. |
| D10 | Archive project | Hides the project and makes its boards read-only. Restore brings everything back. No delete. |
| D11 | Board managers vs project managers | Independent. A board manager still manages one board's fields, statuses, and policies. A project manager manages the project. Neither grants the other. |

## Data model

```prisma
enum ProjectVisibility { PUBLIC PRIVATE }
enum ProjectRole { MANAGER MEMBER }

model Project {
  id          String            @id @default(uuid(7)) @db.Uuid
  workspaceId String            @db.Uuid
  name        String            // 1–80 chars, trimmed
  color       String            // palette token key, never raw hex
  visibility  ProjectVisibility @default(PUBLIC)
  position    Int
  archivedAt  DateTime?
  revision    Int               @default(1)
  createdById String            @db.Uuid
  createdAt   DateTime          @default(now())
  updatedAt   DateTime          @updatedAt

  workspace Workspace       @relation(fields: [workspaceId], references: [id], onDelete: Restrict)
  createdBy User            @relation(fields: [createdById], references: [id], onDelete: Restrict)
  members   ProjectMember[]
  boards    Board[]

  @@unique([workspaceId, name])
  @@index([workspaceId, archivedAt, position])
}

model ProjectMember {
  projectId   String      @db.Uuid
  userId      String      @db.Uuid
  role        ProjectRole @default(MEMBER)
  grantedById String      @db.Uuid
  createdAt   DateTime    @default(now())
  project Project @relation(fields: [projectId], references: [id], onDelete: Cascade)
  user    User    @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@id([projectId, userId])
  @@index([userId])
}
```

- `Board`: add `projectId String? @db.Uuid` (onDelete Restrict), `position Int
  @default(0)`, and `@@index([projectId, position])`. `workspaceId` stays and must
  equal `project.workspaceId` whenever `projectId` is set; the service enforces
  this and a check runs in tests.
- A project member must also be a member of the workspace. Removing someone from
  a workspace cascades out of its projects (service-level, in the same
  transaction).
- `SavedBoardView`: add `layout` enum (see Views).
- Migration: additive only (new tables, a nullable column, an enum, indexes). No
  data rewrite. Existing boards become standalone.

## Access: one scope for every board read

Today every feature filters boards with `board.workspace: workspaceScope(user)`.
Private projects make that insufficient, so it is replaced everywhere by one
function in `server/team-access.ts`:

```ts
// Boards this user may see.
export const boardScope = (user) =>
  isAdministrator(user)
    ? {}
    : {
        workspace: { members: { some: { userId: user.id } } },
        OR: [
          { projectId: null },                                   // standalone
          { project: { visibility: "PUBLIC", archivedAt: null } },
          { project: { members: { some: { userId: user.id } } } },
        ],
      };
```

The archived-project rule for navigation is applied separately. Every place
that reads boards or their children must use it. These are the ones found:

| Area | File | Change |
| ---- | ---- | ------ |
| Board access/writes | `board-service.ts` `access()` | Load board through `boardScope`; reject writes on archived projects. |
| Assignees / People fields | `board-service.ts` `eligiblePeople` | Private project → project members + admins only. |
| Search | `task-search-service.ts` | `board: boardScope(user)`; return `projectName`. |
| Overview | `dashboard-service.ts` | `boardScope` + optional `projectId` filter. |
| Notifications | `notification-service.ts` | Filter by `boardScope` on read, so revoked users stop seeing old ones. |
| Approvals | approval queue/service | Filter by `boardScope`; the approver must still have access when deciding. |
| Realtime | `realtime.ts` | Board tickets require `boardScope` access. Fan-out for private-project boards goes to project members + admins, not the whole workspace. |
| CSV import/export | board routes | Go through `access()`, so covered. |
| Sidebar/layout | `(workspace)/layout.tsx` | Load visible projects and standalone boards. |

A test matrix (below) proves each row for: admin, project manager, project
member, workspace member outside the project, and non-member.

## API

New `api/v1/projects/[action]` (same pattern as boards: zod contract in
`lib/project-contract.ts`, `requireIdentity`, serializable transaction, bounded
payloads, revision checks):

| Action | Who |
| ------ | --- |
| `list` (visible projects with boards; `?archived=1`) | members (scoped) |
| `create` (name, color, visibility) | admins; workspace members if D-open-3 says so |
| `update` (name, color, visibility, `revision`) | admin, project manager |
| `reorder` (permutation of project ids) | admin |
| `archive` / `restore` | admin, project manager |
| `member` (add, change role, remove) | admin, project manager; never removes the last manager unless an admin acts |
| `move-board` (to a project or standalone; same workspace) | admin, or manager of source and target |

`manageBoard("create-board")` accepts `projectId` (optional) in addition to
`workspaceId`, and applies D6/D7.

Realtime hints for project changes reuse per-user fan-out. Clients invalidate
`["principal", id, "projects", workspaceId]`. Dashboard keys add `projectId`.

## Setup

`completeSetup` keeps creating the workspace and first board, which is
standalone. The wizard is unchanged, so it stays short. Projects are introduced
in the app once there is something to group.

## UI (shadcn Sidebar, redesign shell)

### Sidebar

```
Overview / Approvals / Inbox

Projects                              [+]
 ▾ [Y] Yuzu 1.0
     • Q4 Launch
     • Design system
 ▸ [P] People ops               🔒
Boards                                [+]
 • Team requests
 • Hiring pipeline
```

- "Projects": a `SidebarGroup` whose collapsible items have boards as
  `SidebarMenuSub`. The project badge is its initial on a palette-token color.
  Private projects show a lock icon, with the accessible label "Private project".
- "Boards": a second `SidebarGroup` for standalone boards.
- Item menu (`SidebarMenuAction`, available on hover and keyboard focus): Rename,
  Change color, Members, Make private/public, Archive. Reorder uses "Move up/down"
  so it doesn't depend on drag.
- Collapsed (icon) sidebar: the badge with a tooltip; clicking opens a popover of
  boards.

### Project page `/projects/[id]`

Header: name, a visibility pill ("Private, 6 members" or "Visible to the
workspace"), member avatars, "Members", and "New board". Below it, the
project's boards as rows with progress bars (same treatment as the Overview),
then "Deadlines this week" and "Waiting on approval" for this project only.

### Flows and copy

- **Create project** dialog: "Project name", color swatches (each named for
  screen readers), and visibility as two clear choices:
  - "Workspace: everyone in Acme Studio can see it"
  - "Private: only people you add"

  Button: "Create project".
- **Members** sheet: search workspace members, add as Member or Manager, remove.
  Removing shows: "Remove Lee? They'll lose access to this project's 3 boards
  right away."
- **Make private** confirm: "Make Yuzu 1.0 private? 9 people who aren't project
  members will lose access." Button: "Make private".
- **Move board**: "Move to…" lists projects (with privacy shown) plus "No
  project (standalone)". When moving into a private project, the dialog states
  who will lose access before you confirm.
- **Archive**: "Archive Yuzu 1.0? Its boards will be hidden and read-only until
  you restore it. Nothing is deleted." Toast: "Project archived" with "Restore".
- **Empty project**: citrus artwork, "No boards in this project yet", and
  "New board".

Board header breadcrumb: `Project › Board`, or just `Board` when standalone. View
tabs (Kanban, Table, and later Calendar, Timeline) sit under the board title and
never appear in the sidebar.

## Testing

- **Unit:** contracts; `boardScope` for each role × visibility × archived; the
  last-manager rule; `move-board` workspace rule; eligiblePeople for private
  projects.
- **Integration:** for each row of the access table, a private-project board is
  invisible to a workspace member outside it (search, overview, notifications,
  approvals, realtime ticket, task/comment/file reads, CSV export).
- **Leak regression:** remove a member from a private project, then verify that
  their open task, cached search, notification link, and realtime ticket all
  stop working.
- **E2E (`projects.spec.ts`):** create a public project with a board; create a
  private project, add a member, check that a second user can't see it, then
  add them and check that they can; move a board; archive/restore; keyboard-only
  sidebar.

## Rollout (separate branches, in order)

1. `feat/projects-data`: schema, migration, `boardScope` swap across every
   service in the access table, project API, unit and integration tests. The UI is
   unchanged; existing boards are standalone, so behavior is identical.
2. `feat/projects-ui`: sidebar groups, project page, dialogs, member management,
   breadcrumb, search/overview labels, e2e.
3. `SavedBoardView.layout` plus view tabs (Calendar/Timeline later).
4. The app redesign phases.

Update `docs/DEVELOPMENT_CONTEXT.md` after each phase.

## Related gaps

- Boards can't be renamed or archived; workspaces can't be created after setup.
  These are small separate specs.

## Open questions for review

1. D2: should owners/admins see private projects (proposed), or should private
   projects be truly private even from admins?
2. Can a project include people from other workspaces, or only that workspace's
   members (proposed)?
3. Who can create projects: only admins, or any workspace member (who then
   manages it)?
4. Should a private project's name be hidden from non-members everywhere
   (proposed), or visible as "Private project" with no contents?
