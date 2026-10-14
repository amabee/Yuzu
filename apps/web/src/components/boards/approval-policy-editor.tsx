"use client";
import { useState } from "react";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import type { BoardState } from "@/lib/board-contract";
export function ApprovalPolicyEditor({
  state,
  pending,
  onAction,
}: {
  state: BoardState;
  pending: boolean;
  onAction: (action: string, input: unknown) => void;
}) {
  const [policy, setPolicy] = useState(state.approvalPolicy);
  const toggles = [
    [
      "enabled",
      "Approval mode",
      "Protected changes go to a reviewer before they affect the board.",
    ],
    [
      "requireCreation",
      "Require approval to create tasks",
      "New tasks stay in the queue until accepted.",
    ],
    [
      "requireChanges",
      "Require approval for protected fields",
      "A request containing a protected field is reviewed as one complete change.",
    ],
    [
      "requireArchive",
      "Require approval to archive tasks",
      "The task stays active while the archive request is pending.",
    ],
  ] as const;
  return (
    <section
      className="space-y-4 border-t pt-5"
      aria-label="Board approval settings"
    >
      <h3 className="text-sm font-semibold">Approval settings</h3>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          onAction("approval-policy", {
            ...policy,
            protectedFieldIds: policy.protectedFieldIds.filter((id) =>
              state.fields.some((field) => field.id === id),
            ),
            boardId: state.boardId,
          });
        }}
      >
        <fieldset disabled={pending} className="space-y-4">
          {toggles.map(([key, label, description]) => (
            <div className="flex items-start justify-between gap-4" key={key}>
              <div>
                <label
                  htmlFor={`policy-${key}`}
                  className="text-xs font-medium"
                >
                  {label}
                </label>
                <p className="mt-1 max-w-80 text-xs leading-5 text-muted-foreground">
                  {description}
                </p>
              </div>
              <Switch
                id={`policy-${key}`}
                aria-label={label}
                checked={policy[key]}
                disabled={pending || (key !== "enabled" && !policy.enabled)}
                onCheckedChange={(checked) =>
                  setPolicy({ ...policy, [key]: checked })
                }
              />
            </div>
          ))}
          <div className="space-y-3">
            <label className="task-field-label">
              Primary approver
              <select
                className="task-select"
                aria-label="Primary approver"
                value={policy.primaryApproverId ?? ""}
                onChange={(event) =>
                  setPolicy({
                    ...policy,
                    primaryApproverId: event.target.value || null,
                    backupApproverId:
                      event.target.value === policy.backupApproverId
                        ? null
                        : policy.backupApproverId,
                  })
                }
              >
                <option value="">Choose a person</option>
                {state.people.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.name}
                  </option>
                ))}
                {policy.primaryApproverId &&
                  !state.people.some(
                    (person) => person.id === policy.primaryApproverId,
                  ) && (
                    <option value={policy.primaryApproverId}>
                      Former member — choose a replacement
                    </option>
                  )}
              </select>
            </label>
            <label className="task-field-label">
              Backup approver
              <select
                className="task-select"
                aria-label="Backup approver"
                value={policy.backupApproverId ?? ""}
                onChange={(event) =>
                  setPolicy({
                    ...policy,
                    backupApproverId: event.target.value || null,
                  })
                }
              >
                <option value="">No backup</option>
                {state.people
                  .filter((person) => person.id !== policy.primaryApproverId)
                  .map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.name}
                    </option>
                  ))}
                {policy.backupApproverId &&
                  !state.people.some(
                    (person) => person.id === policy.backupApproverId,
                  ) && (
                    <option value={policy.backupApproverId}>
                      Former member — choose a replacement
                    </option>
                  )}
              </select>
            </label>
            <p className="text-xs leading-5 text-muted-foreground">
              One other person’s decision is enough. The backup reviews the
              primary approver’s own requests. Without an eligible backup, those
              protected changes stay blocked.
            </p>
          </div>
          <fieldset
            disabled={!policy.enabled || !policy.requireChanges || pending}
            className="space-y-2"
          >
            <legend className="mb-2 text-xs font-medium">
              Protected fields
            </legend>
            {state.fields.map((field) => (
              <label key={field.id} className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  aria-label={`Require approval for ${field.name}`}
                  checked={policy.protectedFieldIds.includes(field.id)}
                  onChange={(event) =>
                    setPolicy({
                      ...policy,
                      protectedFieldIds: event.target.checked
                        ? [...policy.protectedFieldIds, field.id]
                        : policy.protectedFieldIds.filter(
                            (id) => id !== field.id,
                          ),
                    })
                  }
                />
                {field.name}
              </label>
            ))}
          </fieldset>
          <p className="text-xs leading-5 text-muted-foreground">
            Turning approval off never applies pending requests. Requests made
            incompatible by a policy change must be submitted again.
          </p>
          <Button type="submit" size="sm">
            {pending ? "Saving…" : "Save approval settings"}
          </Button>
        </fieldset>
      </form>
    </section>
  );
}
