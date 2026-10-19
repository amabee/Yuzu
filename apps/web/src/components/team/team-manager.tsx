"use client";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/api-client";
import { teamStateSchema } from "@/lib/team-contract";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/setup/field";

export function TeamManager() {
  const client = useQueryClient();
  const [selected, setSelected] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const team = useQuery({
    queryKey: ["team"],
    queryFn: async ({ signal }) =>
      teamStateSchema.parse(
        (await apiRequest("/api/v1/team/state", { signal })).data,
      ),
  });
  const workspaceId = selected || team.data?.workspaces[0]?.id || "";
  const action = useMutation({
    mutationFn: ({ action, input }: { action: string; input: unknown }) =>
      apiRequest(`/api/v1/team/${action}`, { method: "POST", json: input }),
    onMutate: () => setMessage(""),
    onSuccess: async (_, variables) => {
      setMessage(
        variables.action === "invite"
          ? "Invitation sent. Ask your teammate to check their inbox."
          : "Team access updated.",
      );
      if (variables.action === "invite") setEmail("");
      await client.invalidateQueries({ queryKey: ["team"] });
    },
    onSettled: () => client.invalidateQueries({ queryKey: ["team"] }),
  });
  if (team.isPending) return <p role="status">Loading team access…</p>;
  if (team.error) return <p role="alert">{team.error.message}</p>;
  return (
    <div className="space-y-8">
      <Field id="workspace" label="Workspace">
        <select
          id="workspace"
          className="w-full rounded-lg border bg-card p-3"
          value={workspaceId}
          onChange={(event) => setSelected(event.target.value)}
        >
          {team.data.workspaces.map((workspace) => (
            <option key={workspace.id} value={workspace.id}>
              {workspace.name}
            </option>
          ))}
        </select>
      </Field>
      <section className="rounded-xl border bg-card p-6">
        <h2 className="text-lg font-semibold">Invite a teammate</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Invitations grant membership in this workspace. Links expire after
          seven days. Members can view boards; task editing follows separate
          permissions.
        </p>
        <form
          className="mt-5 flex flex-wrap items-end gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            action.mutate({ action: "invite", input: { workspaceId, email } });
          }}
        >
          <div className="min-w-0 flex-1">
            <Field label="Teammate email" id="invite-email">
              <Input
                id="invite-email"
                type="email"
                required
                maxLength={254}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </Field>
          </div>
          <Button disabled={action.isPending || !workspaceId} type="submit">
            Send invitation
          </Button>
        </form>
      </section>
      {action.error && (
        <p role="alert" className="text-sm text-destructive">
          {action.error.message}
        </p>
      )}
      {message && (
        <p role="status" className="text-sm">
          {message}
        </p>
      )}
      <section>
        <h2 className="mb-4 text-lg font-semibold">Workspace members</h2>
        <div className="space-y-3">
          {team.data.members
            .filter((member) => member.workspaceId === workspaceId)
            .map((member) => (
              <div
                key={member.userId}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-4"
              >
                <div>
                  <p className="font-medium">{member.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {member.email} · {member.role.toLowerCase()}
                  </p>
                </div>
                {member.role === "MEMBER" && (
                  <Button
                    variant="outline"
                    disabled={action.isPending}
                    onClick={() => {
                      if (
                        window.confirm(
                          `Remove ${member.name} from this workspace? They will lose access immediately.`,
                        )
                      )
                        action.mutate({
                          action: "remove",
                          input: { workspaceId, userId: member.userId },
                        });
                    }}
                  >
                    Remove member
                  </Button>
                )}
              </div>
            ))}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Owners and administrators can access every workspace.
        </p>
      </section>
      <section id="invitations" className="scroll-mt-20">
        <h2 className="mb-4 text-lg font-semibold">Invitations</h2>
        <div className="space-y-3">
          {team.data.invitations
            .filter((invite) => invite.workspaceId === workspaceId)
            .map((invite) => (
              <div
                key={invite.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-4"
              >
                <div>
                  <p className="font-medium">{invite.email}</p>
                  <p className="text-sm text-muted-foreground">
                    {invite.status} · expires{" "}
                    {new Date(invite.expiresAt).toLocaleDateString()}
                  </p>
                </div>
                {invite.status !== "accepted" && (
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      disabled={action.isPending}
                      onClick={() =>
                        action.mutate({
                          action: "invite",
                          input: { workspaceId, email: invite.email },
                        })
                      }
                    >
                      Resend
                    </Button>
                    {["pending", "sending"].includes(invite.status) && (
                      <Button
                        variant="outline"
                        disabled={action.isPending}
                        onClick={() =>
                          action.mutate({
                            action: "revoke",
                            input: { id: invite.id },
                          })
                        }
                      >
                        Revoke
                      </Button>
                    )}
                  </div>
                )}
              </div>
            ))}
          {!team.data.invitations.some(
            (invite) => invite.workspaceId === workspaceId,
          ) && (
            <p className="text-sm text-muted-foreground">No invitations yet.</p>
          )}
        </div>
      </section>
    </div>
  );
}
