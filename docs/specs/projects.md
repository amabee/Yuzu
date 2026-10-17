# Projects: spec

Status: draft v3, 2026-10-18. Decisions confirmed by the owner; nothing implemented yet.
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
| D2 | Who sees a **private** project? | Only its project members. Admins do **not** see its boards or data in normal use. Admins can see that it exists (name, managers) in Settings › Projects and can choose **"Join to recover access"**, which adds them as manager, writes an `AccessEvent`, and notifies the project's managers. (Confirmed.) |
| D3 | Project roles | `MANAGER` (settings, members, create boards) and `MEMBER` (normal board work). The creator becomes manager. |
| D4 | Must a board belong to a project? | No. `Board.projectId` is nullable; null means standalone. |
| D5 | Existing boards after migration | They stay standalone. No data is moved. |
| D6 | Who creates standalone boards? | Unchanged from today: admins and existing board managers in the workspace. |
| D6b | Who creates projects? | Any workspace member. The creator becomes its manager. (Confirmed.) |
| D6c | People outside the workspace | Can be **invited** to a project. Accepting makes them a project member only: they see that project's boards and nothing else in the workspace (no standalone boards, no other projects, no workspace overview). (Confirmed.) |
| D6d | Private project names | Hidden from non-members everywhere: navigation, search, overview, notifications, assignee pickers, and error messages (a forbidden private board returns the same "not found" as a missing one). (Confirmed.) |
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
- Project members may be workspace members or **project-only** people invited
  from outside (D6c). Removing someone from a workspace removes their memberships
  in that workspace's projects unless they were invited project-only.
- `Invitation` gains an optional `projectId` and `projectRole`. With a
  `projectId`, accepting creates a `ProjectMember` (and an account if needed) but
  no `WorkspaceMember`. It uses the existing invitation emails, expiry, and
  revocation.
- `SavedBoardView`: add `layout` enum (see Views).
- Migration: additive only (new tables, a nullable column, an enum, indexes). No
  data rewrite. Existing boards become standalone.

## Access: one scope for every board read

Today every feature filters boards with `board.workspace: workspaceScope(user)`.
Private projects make that insufficient, so it is replaced everywhere by one
function in `server/team-access.ts`:

```ts
// Boards this user may see.
// Boards this user may see. Private projects are excluded even for admins (D2).
export const boardScope = (user) => {
  const inWorkspace = isAdministrator(user)
    ? {}
    : { workspace: { members: { some: { userId: user.id } } } };
  return {
    OR: [
      { ...inWorkspace, projectId: null },                                // standalone
      { ...inWorkspace, project: { visibility: "PUBLIC" } },              // public project
      { project: { members: { some: { userId: user.id } } } },            // any project they belong to,
    ],                                                                    // incl. project-only invitees
  };
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

### Admin recovery (D2)

- Settings › Projects (admins only) lists every project, including private ones,
  by name and managers only, never contents.
- "Join to recover access" requires a typed confirmation, then adds the admin as
  `MANAGER`, writes `AccessEvent { kind: "project.recovery" }`, and notifies all
  current managers by in-app notification and email.
- Project managers can see the recovery entry in the project's member history.

## API

New `api/v1/projects/[action]` (same pattern as boards: zod contract in
`lib/project-contract.ts`, `requireIdentity`, serializable transaction, bounded
payloads, revision checks):

| Action | Who |
| ------ | --- |
| `list` (visible projects with boards; `?archived=1`) | members (scoped) |
| `create` (name, color, visibility) | any workspace member (D6b) |
| `update` (name, color, visibility, `revision`) | admin, project manager |
| `reorder` (permutation of project ids) | admin |
| `archive` / `restore` | admin, project manager |
| `member` (add workspace member, change role, remove) | project manager; never removes the last manager |
| `invite` / `revoke-invite` (email, role) | project manager |
| `recover` (admin joins as manager, audited) | admin |
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
- **Members** sheet: search workspace members to add, or "Invite by email" for
  people outside the workspace (shown with a "Project only" badge). Choose Member
  or Manager. Pending invites are listed with "Resend" and "Revoke".
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

## Resolved questions

1. Private projects are hidden from admins in normal use, with audited recovery (D2).
2. People outside a workspace join a project by invitation, as project-only members (D6c).
3. Any workspace member can create projects (D6b).
4. Private project names are hidden from non-members everywhere (D6d).
