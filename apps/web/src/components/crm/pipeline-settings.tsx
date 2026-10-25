"use client";
import { useState } from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { ArrowDown, ArrowUp, Plus, ShieldCheck, Trash2, X } from "lucide-react";
import { ApiError } from "@/lib/api-client";
import {
  approvalPolicySchema,
  type ApprovalPolicy,
} from "@/lib/approval-contract";
import {
  categoryLabels,
  stageBlockersSchema,
  stageCategories,
  type PipelineSummary,
  type StageApprovalRule,
  type StageCategory,
  type StageCommand,
} from "@/lib/deal-contract";
import { saveError, type CrmScope } from "./use-crm";
import { useConfigureApprovals, useStageCommand } from "./use-deals";

const hints: Record<StageCategory, string> = {
  OPEN: "Deals in progress",
  WON: "Closes a deal as won",
  LOST: "Closes a deal as lost",
};
/** A stage command without the pipeline it applies to. */
type StageChange = StageCommand extends infer Command
  ? Command extends unknown
    ? Omit<Command, "boardId" | "version">
    : never
  : never;
type Problem = {
  message: string;
  deals: { name: string; state: string }[];
  requests?: { dealName: string; to: string; authorName: string }[];
};
type Settings = NonNullable<PipelineSummary["approvalSettings"]>;

/**
 * Approvals for a pipeline: who approves, which stage moves wait for them,
 * and which other deal fields do. Changes save as they're made.
 */
function PipelineApprovals({
  scope,
  pipeline,
  settings,
  onRule,
  onProblem,
}: {
  scope: CrmScope;
  pipeline: PipelineSummary;
  settings: Settings;
  onRule: (rule: StageApprovalRule) => void;
  onProblem: (message: string) => void;
}) {
  const configure = useConfigureApprovals(scope);
  const save = (changes: Partial<ApprovalPolicy>) => {
    configure.mutate(
      {
        ...approvalPolicySchema.parse(settings),
        ...changes,
        boardId: pipeline.boardId,
      },
      { onError: (error) => onProblem(saveError(error)) },
    );
  };
  const approver = (id: string | null) =>
    settings.people.find((person) => person.id === id)?.name;
  return (
    <section className="deal-approvals" aria-label="Approvals">
      <h3>
        <ShieldCheck size={15} aria-hidden="true" />
        Approvals
        <label className="deal-switch">
          <input
            type="checkbox"
            checked={settings.enabled}
            disabled={configure.isPending}
            onChange={(event) =>
              event.target.checked && !settings.primaryApproverId
                ? onProblem("Choose an approver before turning approvals on.")
                : save({ enabled: event.target.checked })
            }
          />
          {settings.enabled ? "On" : "Off"}
        </label>
      </h3>
      <div className="deal-approvers">
        <label>
          Approver
          <select
            value={settings.primaryApproverId ?? ""}
            disabled={configure.isPending}
            onChange={(event) =>
              save({
                primaryApproverId: event.target.value || null,
                ...(event.target.value === settings.backupApproverId
                  ? { backupApproverId: null }
                  : {}),
              })
            }
          >
            <option value="">Nobody yet</option>
            {settings.people.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Backup
          <select
            value={settings.backupApproverId ?? ""}
            disabled={configure.isPending || !settings.primaryApproverId}
            onChange={(event) =>
              save({ backupApproverId: event.target.value || null })
            }
          >
            <option value="">No backup</option>
            {settings.people
              .filter((person) => person.id !== settings.primaryApproverId)
              .map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))}
          </select>
        </label>
      </div>
      <fieldset className="deal-rule">
        <legend>Stage changes that need approval</legend>
        {(
          [
            [
              "CLOSING",
              "Closing and reopening",
              "Into or out of Won and Lost. Moves between open stages happen straight away.",
            ],
            [
              "ALL",
              "Every stage move",
              `Each move waits for ${approver(settings.primaryApproverId) ?? "the approver"}${settings.backupApproverId ? `, or ${approver(settings.backupApproverId)} as backup` : ""}.`,
            ],
          ] as const
        ).map(([rule, label, hint]) => (
          <label key={rule}>
            <input
              type="radio"
              name={`stage-rule-${pipeline.boardId}`}
              checked={pipeline.stageApproval === rule}
              onChange={() => onRule(rule)}
            />
            <span>
              {label}
              <small>{hint}</small>
            </span>
          </label>
        ))}
      </fieldset>
      <fieldset className="deal-rule">
        <legend>Other changes that need approval</legend>
        {settings.fields.map((field) => (
          <label key={field.id}>
            <input
              type="checkbox"
              checked={settings.protectedFieldIds.includes(field.id)}
              disabled={configure.isPending}
              onChange={(event) =>
                save({
                  requireChanges: true,
                  protectedFieldIds: event.target.checked
                    ? [...settings.protectedFieldIds, field.id]
                    : settings.protectedFieldIds.filter(
                        (id) => id !== field.id,
                      ),
                })
              }
            />
            <span>{field.key === "assignees" ? "Owner" : field.name}</span>
          </label>
        ))}
      </fieldset>
      {!settings.enabled && (
        <p className="deal-dialog-text">
          While approvals are off, everyone who can edit deals moves them
          directly.
        </p>
      )}
    </section>
  );
}

/** A pipeline's stages: names, categories, order, default; managers only. */
export function PipelineSettings({
  scope,
  pipeline,
  open,
  onOpenChange,
}: {
  scope: CrmScope;
  pipeline: PipelineSummary;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const command = useStageCommand(scope);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [adding, setAdding] = useState<Record<string, string>>({});
  const run = (body: StageChange, done?: () => void) =>
    command.mutate(
      {
        ...body,
        boardId: pipeline.boardId,
        version: pipeline.version,
      } as StageCommand,
      {
        onSuccess: () => {
          setProblem(null);
          done?.();
        },
        onError: (error) => {
          const blockers =
            error instanceof ApiError
              ? stageBlockersSchema.safeParse(error.details)
              : null;
          setProblem({
            message: saveError(error),
            deals: blockers?.success ? blockers.data.deals : [],
            requests: blockers?.success ? blockers.data.requests : [],
          });
        },
      },
    );
  const stages = pipeline.stages;
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="crm-scrim" />
        <DialogPrimitive.Content className="deal-dialog deal-settings">
          <div className="deal-dialog-head">
            <div>
              <DialogPrimitive.Title className="deal-dialog-title">
                Pipeline settings
              </DialogPrimitive.Title>
              <DialogPrimitive.Description className="deal-dialog-text">
                Stages run left to right on the board. Every pipeline keeps an
                Open, a Won and a Lost stage; new deals start in the default
                stage.
              </DialogPrimitive.Description>
            </div>
            <DialogPrimitive.Close
              className="crm-icon-button"
              aria-label="Close"
            >
              <X size={15} aria-hidden="true" />
            </DialogPrimitive.Close>
          </div>
          {problem && (
            <div className="deal-problem" role="alert">
              <b>{problem.message}</b>
              {problem.deals.length > 0 && (
                <ul>
                  {problem.deals.map((deal, index) => (
                    <li key={index}>
                      {deal.name}
                      {deal.state === "ARCHIVED"
                        ? " · Archived"
                        : deal.state === "TRASH"
                          ? " · In Trash"
                          : ""}
                    </li>
                  ))}
                </ul>
              )}
              {Boolean(problem.requests?.length) && (
                <ul>
                  {problem.requests!.map((request, index) => (
                    <li key={index}>
                      Move {request.dealName} to {request.to}, asked by{" "}
                      {request.authorName}. Open the deal to cancel it.
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {pipeline.approvalSettings && (
            <PipelineApprovals
              scope={scope}
              pipeline={pipeline}
              settings={pipeline.approvalSettings}
              onRule={(rule) => run({ action: "approvals", rule })}
              onProblem={(message) => setProblem({ message, deals: [] })}
            />
          )}
          <div className="deal-stage-groups">
            {stageCategories.map((category) => {
              const list = stages.filter(
                (stage) => stage.category === category,
              );
              return (
                <section
                  key={category}
                  data-category={category}
                  aria-label={`${categoryLabels[category]} stages`}
                >
                  <h3>
                    <i aria-hidden="true" />
                    {categoryLabels[category]}
                    <small>{hints[category]}</small>
                  </h3>
                  <ul>
                    {list.map((stage) => {
                      const position = stages.indexOf(stage);
                      return (
                        <li key={stage.id}>
                          <input
                            aria-label="Stage name"
                            defaultValue={stage.name}
                            key={stage.name}
                            maxLength={40}
                            disabled={!pipeline.canManage}
                            onBlur={(event) => {
                              const name = event.target.value.trim();
                              if (name && name !== stage.name)
                                run({
                                  action: "update",
                                  stageId: stage.id,
                                  name,
                                });
                              else event.target.value = stage.name;
                            }}
                            onKeyDown={(event) => {
                              if (event.key === "Enter")
                                event.currentTarget.blur();
                            }}
                          />
                          <select
                            aria-label={`Category of ${stage.name}`}
                            value={stage.category}
                            disabled={!pipeline.canManage}
                            onChange={(event) =>
                              run({
                                action: "update",
                                stageId: stage.id,
                                category: event.target.value as StageCategory,
                              })
                            }
                          >
                            {stageCategories.map((value) => (
                              <option key={value} value={value}>
                                {categoryLabels[value]}
                              </option>
                            ))}
                          </select>
                          {category === "OPEN" ? (
                            <label className="deal-default">
                              <input
                                type="radio"
                                name={`default-${pipeline.boardId}`}
                                checked={stage.id === pipeline.defaultStageId}
                                disabled={!pipeline.canManage}
                                onChange={() =>
                                  run({ action: "default", stageId: stage.id })
                                }
                              />
                              Default
                            </label>
                          ) : (
                            <span className="crm-count">
                              {stage.count}{" "}
                              {stage.count === 1 ? "deal" : "deals"}
                            </span>
                          )}
                          <span className="deal-stage-tools">
                            <button
                              type="button"
                              className="crm-icon-button"
                              aria-label={`Move ${stage.name} earlier`}
                              disabled={!pipeline.canManage || position === 0}
                              onClick={() =>
                                run({
                                  action: "move",
                                  stageId: stage.id,
                                  position: position - 1,
                                })
                              }
                            >
                              <ArrowUp size={14} aria-hidden="true" />
                            </button>
                            <button
                              type="button"
                              className="crm-icon-button"
                              aria-label={`Move ${stage.name} later`}
                              disabled={
                                !pipeline.canManage ||
                                position === stages.length - 1
                              }
                              onClick={() =>
                                run({
                                  action: "move",
                                  stageId: stage.id,
                                  position: position + 1,
                                })
                              }
                            >
                              <ArrowDown size={14} aria-hidden="true" />
                            </button>
                            <button
                              type="button"
                              className="crm-icon-button"
                              aria-label={`Remove ${stage.name}`}
                              disabled={!pipeline.canManage}
                              onClick={() =>
                                run({ action: "remove", stageId: stage.id })
                              }
                            >
                              <Trash2 size={14} aria-hidden="true" />
                            </button>
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                  {pipeline.canManage && (
                    <form
                      className="deal-add-stage"
                      onSubmit={(event) => {
                        event.preventDefault();
                        const name = (adding[category] ?? "").trim();
                        if (name)
                          run({ action: "add", name, category }, () =>
                            setAdding({ ...adding, [category]: "" }),
                          );
                      }}
                    >
                      <input
                        aria-label={`New ${categoryLabels[category].toLowerCase()} stage`}
                        placeholder={`New ${categoryLabels[category]} stage`}
                        maxLength={40}
                        value={adding[category] ?? ""}
                        onChange={(event) =>
                          setAdding({
                            ...adding,
                            [category]: event.target.value,
                          })
                        }
                      />
                      <button
                        type="submit"
                        className="crm-button"
                        data-size="sm"
                        disabled={!(adding[category] ?? "").trim()}
                      >
                        <Plus size={14} aria-hidden="true" />
                        Add
                      </button>
                    </form>
                  )}
                </section>
              );
            })}
          </div>
          <p className="deal-dialog-foot">Changes save as you make them.</p>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
