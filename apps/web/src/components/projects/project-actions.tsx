"use client";
import { useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useRouter } from "nextjs-toploader/app";
import { Archive, Pencil, Trash2, Users } from "lucide-react";
import { DeleteDialog } from "@/components/trash/delete-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  PauseButton,
  PauseClose,
  PauseDialog,
  PauseModal,
} from "@/components/pause/pause-dialog";
import { CreateBoard } from "@/components/boards/create-board";
import { ColorSwatches, VisibilityChoice } from "./project-form-fields";
import { ArchiveProjectDialog } from "./archive-project";
import { useProjectAction } from "./use-project-action";

type Role = "MANAGER" | "MEMBER";
type Member = {
  id: string;
  name: string;
  email: string;
  role: Role;
  projectOnly: boolean;
};
type Project = {
  id: string;
  name: string;
  color: string;
  visibility: "PUBLIC" | "PRIVATE";
  revision: number;
  boardCount: number;
};

export function ProjectActions({
  project,
  workspaceName,
  canManage,
  viewerId,
  members,
  candidates,
  invitations,
  outsiders,
}: {
  project: Project;
  workspaceName: string;
  canManage: boolean;
  viewerId: string;
  members: Member[];
  candidates: { id: string; name: string; email: string }[];
  invitations: { id: string; email: string; role: Role }[];
  outsiders: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  // The sidebar menu opens panels with ?panel=, which can arrive while this
  // page is already mounted, so the URL is read on every render.
  const requested = useSearchParams().get("panel");
  const [chosen, setPanel] = useState<"members" | "edit" | null>(null);
  const panel =
    chosen ??
    (requested === "members" || (requested === "edit" && canManage)
      ? requested
      : null);
  const [archiving, setArchiving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const openPanel = (next: "members" | "edit" | null) => {
    setPanel(next);
    // Drop ?panel= so a refresh or back navigation doesn't reopen it.
    if (!next) router.replace(pathname, { scroll: false });
  };
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => openPanel("members")}>
        <Users size={15} /> Members
      </Button>
      {canManage && (
        <>
          <Button variant="outline" size="sm" onClick={() => openPanel("edit")}>
            <Pencil size={15} /> Edit
          </Button>
          <Button
            variant="ghost"
            size="sm"
            aria-label="Archive project"
            title="Archive project"
            onClick={() => setArchiving(true)}
          >
            <Archive size={15} />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            aria-label="Delete project"
            title="Delete project"
            onClick={() => setDeleting(true)}
          >
            <Trash2 size={15} />
          </Button>
          <CreateBoard
            workspaces={[]}
            project={{ id: project.id, name: project.name }}
          />
        </>
      )}
      <MembersSheet
        open={panel === "members"}
        onOpenChange={(open) => openPanel(open ? "members" : null)}
        project={project}
        canManage={canManage}
        viewerId={viewerId}
        members={members}
        candidates={candidates}
        invitations={invitations}
      />
      {canManage && (
        <EditProjectSheet
          // Reset the form whenever the saved project changes.
          key={project.revision}
          open={panel === "edit"}
          onOpenChange={(open) => openPanel(open ? "edit" : null)}
          project={project}
          workspaceName={workspaceName}
          outsiders={outsiders}
        />
      )}
      <ArchiveProjectDialog
        project={archiving ? project : null}
        onOpenChange={setArchiving}
      />
      <DeleteDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={`Delete the ${project.name} project?`}
        description="The project and its boards move to Trash and disappear for everyone. Its managers or an admin can restore it from Settings → Trash."
        confirm="Delete project"
        action="delete-project"
        id={project.id}
        onDeleted={() => {
          router.push("/boards");
          router.refresh();
        }}
      />
    </>
  );
}

function EditProjectSheet({
  open,
  onOpenChange,
  project,
  workspaceName,
  outsiders,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: Project;
  workspaceName: string;
  outsiders: number;
}) {
  const [name, setName] = useState(project.name);
  const [color, setColor] = useState(project.color);
  const [visibility, setVisibility] = useState(project.visibility);
  const [confirming, setConfirming] = useState(false);
  const update = useProjectAction("update", () => {
    setConfirming(false);
    onOpenChange(false);
  });
  const changes = {
    ...(name.trim() !== project.name ? { name } : {}),
    ...(color !== project.color ? { color } : {}),
    ...(visibility !== project.visibility ? { visibility } : {}),
  };
  const save = () =>
    update.mutate({
      projectId: project.id,
      revision: project.revision,
      ...changes,
    });
  return (
    <>
      <PauseModal
        open={open}
        onOpenChange={onOpenChange}
        title="Edit project"
        description={`Changes apply for everyone who can see ${project.name}.`}
        as="form"
        footer="Renaming keeps every board and link."
        actions={
          <>
            <PauseClose asChild>
              <PauseButton>Cancel</PauseButton>
            </PauseClose>
            <PauseButton
              tone="primary"
              type="submit"
              disabled={update.isPending || Object.keys(changes).length === 0}
            >
              {update.isPending ? "Saving…" : "Save changes"}
            </PauseButton>
          </>
        }
        onSubmit={(event) => {
          event.preventDefault();
          if (
            visibility === "PRIVATE" &&
            project.visibility === "PUBLIC" &&
            outsiders > 0
          )
            setConfirming(true);
          else save();
        }}
      >
        <label className="task-field-label">
          Project name
          <Input
            aria-label="Project name"
            required
            maxLength={100}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <div className="task-field-label">
          Color
          <ColorSwatches value={color} onChange={setColor} />
        </div>
        <VisibilityChoice
          value={visibility}
          onChange={setVisibility}
          workspaceName={workspaceName}
        />
        {update.error && !confirming && (
          <p role="alert" className="text-sm text-destructive">
            {update.error.message}
          </p>
        )}
      </PauseModal>
      <PauseDialog
        open={confirming}
        onOpenChange={setConfirming}
        intent="warning"
        title={`Make ${project.name} private?`}
        description={`${outsiders} ${outsiders === 1 ? "person who isn't" : "people who aren't"} project members will lose access to its boards right away.`}
        actions={
          <>
            <PauseClose asChild>
              <PauseButton>Cancel</PauseButton>
            </PauseClose>
            <PauseButton
              tone="primary"
              data-autofocus
              disabled={update.isPending}
              onClick={save}
            >
              Make private
            </PauseButton>
          </>
        }
      >
        {update.error && (
          <p role="alert" className="text-sm text-destructive">
            {update.error.message}
          </p>
        )}
      </PauseDialog>
    </>
  );
}

function MembersSheet({
  open,
  onOpenChange,
  project,
  canManage,
  viewerId,
  members,
  candidates,
  invitations,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  project: Project;
  canManage: boolean;
  viewerId: string;
  members: Member[];
  candidates: { id: string; name: string; email: string }[];
  invitations: { id: string; email: string; role: Role }[];
}) {
  const [personId, setPersonId] = useState("");
  const [addRole, setAddRole] = useState<Role>("MEMBER");
  const [email, setEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<Role>("MEMBER");
  const [removing, setRemoving] = useState<Member | null>(null);
  const [status, setStatus] = useState("");
  const router = useRouter();
  const member = useProjectAction<
    unknown,
    { action: string; projectId: string; userId: string; role?: Role }
  >("member", (_, change) => {
    setPersonId("");
    setRemoving(null);
    // Leaving a private project removes your access to this page.
    if (
      change.action === "remove" &&
      change.userId === viewerId &&
      project.visibility === "PRIVATE"
    )
      router.push("/");
  });
  const invite = useProjectAction<
    unknown,
    { projectId: string; email: string; role: Role }
  >("invite", (_, variables) => {
    setEmail("");
    setStatus(`Invitation sent to ${variables.email}.`);
  });
  const revoke = useProjectAction("revoke-invite", () =>
    setStatus("Invitation revoked."),
  );
  const error = member.error ?? invite.error ?? revoke.error;
  return (
    <>
      <PauseModal
        open={open}
        onOpenChange={onOpenChange}
        title="Members"
        description={
          project.visibility === "PRIVATE"
            ? "Only these people can see this project and its boards."
            : "Everyone in the workspace can see this project. Managers can change it and add boards."
        }
        footer={canManage ? "Invitations expire in 7 days." : undefined}
        actions={
          <PauseClose asChild>
            <PauseButton tone="primary">Done</PauseButton>
          </PauseClose>
        }
      >
        <p role="status" aria-live="polite" className="sr-only">
          {status}
        </p>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error.message}
          </p>
        )}
        <ul className="divide-y" aria-label="Project members">
          {members.map((person) => (
            <li key={person.id} className="flex items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">
                  {person.name}
                  {person.id === viewerId && (
                    <span className="text-muted-foreground"> (you)</span>
                  )}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {person.email}
                  {person.projectOnly && (
                    <span className="ml-2 rounded-full bg-secondary px-2 py-0.5 text-secondary-foreground">
                      Project only
                    </span>
                  )}
                </p>
              </div>
              {canManage ? (
                <>
                  <select
                    aria-label={`${person.name}'s role`}
                    className="task-select project-role-select"
                    value={person.role}
                    disabled={member.isPending}
                    onChange={(event) =>
                      member.mutate({
                        action: "role",
                        projectId: project.id,
                        userId: person.id,
                        role: event.target.value as Role,
                      })
                    }
                  >
                    <option value="MEMBER">Member</option>
                    <option value="MANAGER">Manager</option>
                  </select>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setRemoving(person)}
                  >
                    Remove
                  </Button>
                </>
              ) : (
                <span className="text-xs text-muted-foreground">
                  {person.role === "MANAGER" ? "Manager" : "Member"}
                </span>
              )}
            </li>
          ))}
        </ul>
        {canManage && (
          <>
            <form
              className="grid gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (personId)
                  member.mutate({
                    action: "add",
                    projectId: project.id,
                    userId: personId,
                    role: addRole,
                  });
              }}
            >
              <span className="task-field-label">Add from the workspace</span>
              <div className="flex gap-2">
                <select
                  aria-label="Person to add"
                  className="task-select min-w-0 flex-1"
                  value={personId}
                  onChange={(event) => setPersonId(event.target.value)}
                >
                  <option value="">
                    {candidates.length
                      ? "Choose a person"
                      : "Everyone is already here"}
                  </option>
                  {candidates.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.name} ({person.email})
                    </option>
                  ))}
                </select>
                <RoleSelect
                  label="Role for the added person"
                  value={addRole}
                  onChange={setAddRole}
                />
              </div>
              <Button disabled={!personId || member.isPending}>
                Add to project
              </Button>
            </form>
            <form
              className="grid gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                invite.mutate({
                  projectId: project.id,
                  email,
                  role: inviteRole,
                });
              }}
            >
              <span className="task-field-label">Invite by email</span>
              <p className="text-xs text-muted-foreground">
                People outside the workspace join as project-only members and
                see nothing else.
              </p>
              <div className="flex gap-2">
                <Input
                  type="email"
                  required
                  aria-label="Email to invite"
                  placeholder="name@example.com"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  className="min-w-0 flex-1"
                />
                <RoleSelect
                  label="Role for the invited person"
                  value={inviteRole}
                  onChange={setInviteRole}
                />
              </div>
              <Button variant="outline" disabled={invite.isPending}>
                {invite.isPending ? "Sending…" : "Send invitation"}
              </Button>
            </form>
            {invitations.length > 0 && (
              <section aria-label="Pending invitations" className="grid gap-1">
                <span className="task-field-label">Pending invitations</span>
                <ul className="divide-y">
                  {invitations.map((pending) => (
                    <li
                      key={pending.id}
                      className="flex items-center gap-2 py-2 text-sm"
                    >
                      <span className="min-w-0 flex-1 truncate">
                        {pending.email}
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={invite.isPending}
                        onClick={() =>
                          invite.mutate({
                            projectId: project.id,
                            email: pending.email,
                            role: pending.role,
                          })
                        }
                      >
                        Resend
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={revoke.isPending}
                        onClick={() => revoke.mutate({ id: pending.id })}
                      >
                        Revoke
                      </Button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </PauseModal>
      <PauseDialog
        open={Boolean(removing)}
        onOpenChange={(next) => !next && setRemoving(null)}
        intent="danger"
        title={`Remove ${removing?.name ?? "this person"}?`}
        description={`They'll lose access to this project's ${project.boardCount} ${project.boardCount === 1 ? "board" : "boards"} right away.`}
        actions={
          <>
            <PauseClose asChild>
              <PauseButton>Cancel</PauseButton>
            </PauseClose>
            <PauseButton
              tone="primary"
              disabled={member.isPending}
              onClick={() =>
                removing &&
                member.mutate({
                  action: "remove",
                  projectId: project.id,
                  userId: removing.id,
                })
              }
            >
              Remove
            </PauseButton>
          </>
        }
      >
        {member.error && (
          <p role="alert" className="text-sm text-destructive">
            {member.error.message}
          </p>
        )}
      </PauseDialog>
    </>
  );
}

function RoleSelect({
  label,
  value,
  onChange,
}: {
  label: string;
  value: Role;
  onChange: (role: Role) => void;
}) {
  return (
    <select
      aria-label={label}
      className="task-select project-role-select"
      value={value}
      onChange={(event) => onChange(event.target.value as Role)}
    >
      <option value="MEMBER">Member</option>
      <option value="MANAGER">Manager</option>
    </select>
  );
}
