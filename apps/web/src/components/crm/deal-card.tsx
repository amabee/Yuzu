"use client";
import { useState } from "react";
import { Dialog as DialogPrimitive, DropdownMenu } from "radix-ui";
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  Ellipsis,
  Trash2,
  X,
} from "lucide-react";
import { categoryLabels, dealCurrency } from "@/lib/deal-contract";
import type { CrmDirectory } from "@/lib/crm-contract";
import { TaskComments } from "@/components/boards/task-comments";
import { TaskFiles } from "@/components/boards/task-files";
import type { TaskUploads } from "@/components/boards/use-task-uploads";
import type { TransferNoticeHandler } from "@/components/ui/yuzu-toast";
import { useUiStore } from "@/components/providers";
import { NameField, useDraft } from "./crm-fields";
import { TrailItems } from "./crm-trail";
import { CustomerField, StagePath, useStageMove } from "./deal-parts";
import {
  saveError,
  useCrmSave,
  type CrmChanges,
  type CrmScope,
  type LifecycleAction,
} from "./use-crm";
import { money, useDeal, usePipeline, type DealDetail } from "./use-deals";

const PAUSED =
  "Stage moves are paused: this pipeline has approvals turned on, and approval for stage changes isn't available yet.";
const time = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

/** A deal as a card in the CRM stack: stage path, history, details. */
export function DealCard({
  dealId,
  depth,
  stack,
  scope,
  people,
  syncInterval,
  uploads,
  onNotice,
  onTransferNotice,
  onLifecycle,
}: {
  dealId: string;
  depth: number;
  stack: string[];
  scope: CrmScope;
  people: CrmDirectory["people"];
  syncInterval: number;
  uploads: TaskUploads;
  onNotice: (message: string, kind: "success" | "error" | "info") => void;
  onTransferNotice: TransferNoticeHandler;
  onLifecycle: (
    action: LifecycleAction,
    record: { id: string; revision: number },
  ) => void;
}) {
  const [tab, setTab] = useState<"overview" | "files">("overview");
  const query = useDeal(scope, dealId);
  const detail = query.data;
  const deal = detail?.deal;
  const pipeline = usePipeline(scope, detail?.boardId ?? scope.boardId);
  const stages = pipeline.data?.stages ?? [];
  const stage = stages.find((item) => item.id === deal?.stageId);
  const trim = useUiStore((state) => state.trimCrmStack);
  const save = useCrmSave(scope);
  const mover = useStageMove(scope, stages, onNotice);
  const top = depth === 0;
  const readOnly = !deal || !deal.canEdit;
  const saveDeal = (changes: CrmChanges) =>
    deal &&
    save.mutate(
      { record: deal, changes },
      {
        onSuccess: (result) =>
          result.outcome === "PENDING_APPROVAL" &&
          onNotice(
            "Sent for approval. It changes once a reviewer approves it.",
            "info",
          ),
        onError: (error) => onNotice(saveError(error), "error"),
      },
    );
  const closed =
    stage && stage.category !== "OPEN" && deal?.closedAt
      ? ` · ${categoryLabels[stage.category]} ${new Date(deal.closedAt).toLocaleDateString()}`
      : "";
  return (
    <article
      className="crm-card"
      data-depth={Math.min(depth, 3)}
      aria-hidden={top ? undefined : true}
      inert={!top}
      aria-label={deal?.name ?? "Loading deal"}
    >
      <header className="crm-card-head">
        <span className="crm-mono deal-mono" data-size="lg" aria-hidden="true">
          {(deal?.name ?? "").slice(0, 2).toUpperCase() || "?"}
        </span>
        <div className="crm-card-who">
          <p className="crm-card-kind">
            Deal{pipeline.data ? ` · ${pipeline.data.name}` : ""}
            {closed}
            {deal?.archivedAt && (
              <span className="crm-tag">Archived · read-only</span>
            )}
          </p>
          {top ? (
            <>
              <DialogPrimitive.Title className="sr-only">
                {deal?.name ?? "Loading deal"}
              </DialogPrimitive.Title>
              <NameField
                label="Deal name"
                record={deal}
                readOnly={readOnly}
                onSave={(name) => saveDeal({ name })}
              />
            </>
          ) : (
            <h2 className="crm-card-name">{deal?.name}</h2>
          )}
        </div>
        <div className="crm-card-tools">
          {stack.length > 1 && (
            <button
              type="button"
              className="crm-button"
              data-size="sm"
              onClick={() => trim(stack.length - 1)}
            >
              <ArrowLeft size={14} aria-hidden="true" />
              Back
            </button>
          )}
          {deal && (
            <DropdownMenu.Root>
              <DropdownMenu.Trigger
                className="crm-icon-button"
                aria-label="More actions"
              >
                <Ellipsis size={16} aria-hidden="true" />
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content
                  className="crm-menu"
                  align="end"
                  sideOffset={6}
                >
                  {deal.archivedAt ? (
                    <DropdownMenu.Item
                      className="crm-menu-item"
                      disabled={!pipeline.data?.canManage}
                      onSelect={() => onLifecycle("restore", deal)}
                    >
                      <ArchiveRestore size={15} aria-hidden="true" />
                      Restore
                    </DropdownMenu.Item>
                  ) : (
                    <DropdownMenu.Item
                      className="crm-menu-item"
                      disabled={!deal.canEdit}
                      onSelect={() => onLifecycle("archive", deal)}
                    >
                      <Archive size={15} aria-hidden="true" />
                      Archive
                    </DropdownMenu.Item>
                  )}
                  <DropdownMenu.Item
                    className="crm-menu-item"
                    data-danger=""
                    disabled={!pipeline.data?.canManage}
                    onSelect={() => onLifecycle("delete", deal)}
                  >
                    <Trash2 size={15} aria-hidden="true" />
                    Move to Trash
                    {!pipeline.data?.canManage && (
                      <small>Pipeline managers and admins delete deals</small>
                    )}
                  </DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          )}
          <DialogPrimitive.Close className="crm-button" data-size="sm">
            <X size={14} aria-hidden="true" />
            Close
          </DialogPrimitive.Close>
        </div>
      </header>
      {stack.length > 1 && (
        <nav className="crm-trail" aria-label="Open records">
          <TrailItems stack={stack} scope={scope} />
        </nav>
      )}
      <div className="deal-card-top">
        {deal && stages.length > 0 && (
          <StagePath
            stages={stages}
            current={deal.stageId}
            disabled={readOnly}
            pausedReason={pipeline.data?.approvals ? PAUSED : null}
            onMove={(stageId) => mover.move(deal, stageId)}
          />
        )}
        <div className="crm-card-tabs" role="tablist" aria-label="Deal views">
          {(
            [
              ["overview", "Overview"],
              ["files", "Files"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
            >
              {label}
              {key === "files" && deal?.attachmentCount ? (
                <span className="crm-count">{deal.attachmentCount}</span>
              ) : null}
            </button>
          ))}
        </div>
      </div>
      <div className="crm-card-body" data-view={tab} role="tabpanel">
        {query.isError ? (
          <div className="crm-empty-state" role="alert">
            <b>This deal isn&apos;t available</b>
            <span>
              It may have been moved to Trash, or your access changed.
            </span>
          </div>
        ) : !detail || !deal ? (
          <div className="crm-empty-state" aria-busy="true">
            <span>Loading…</span>
          </div>
        ) : tab === "overview" ? (
          <>
            <div className="crm-card-main">
              <History detail={detail} />
              <section className="crm-pane crm-updates" aria-label="Updates">
                <div className="crm-updates-feed">
                  <TaskComments
                    state={{
                      boardId: scope.boardId,
                      currentUserId: scope.principalId,
                      people,
                      readOnly: false,
                    }}
                    task={{
                      id: deal.id,
                      archivedAt: deal.archivedAt,
                      commentCount: deal.commentCount,
                    }}
                    active={top}
                    syncInterval={syncInterval}
                    onNotice={onNotice}
                  />
                </div>
              </section>
            </div>
            <DealDetails
              scope={scope}
              detail={detail}
              people={people}
              readOnly={readOnly}
              onSave={saveDeal}
            />
          </>
        ) : (
          <section className="crm-pane crm-wide" aria-label="Files">
            <TaskFiles
              state={{
                boardId: scope.boardId,
                currentUserId: scope.principalId,
              }}
              task={{ id: deal.id, archivedAt: deal.archivedAt }}
              active={top}
              syncInterval={syncInterval}
              onNotice={onNotice}
              onTransferNotice={onTransferNotice}
              uploads={uploads}
            />
          </section>
        )}
      </div>
      {mover.dialog}
    </article>
  );
}

/** "Moved to Proposal", "Marked won", "Reopened in Negotiation". */
function headline(event: DealDetail["history"][number]) {
  const named = (verb: string, category: string) =>
    event.to.toLowerCase() === category ? verb : `${verb} (${event.to})`;
  if (event.kind === "CREATED") return `Created in ${event.to}`;
  if (event.kind === "WON") return named("Marked won", "won");
  if (event.kind === "LOST") return named("Marked lost", "lost");
  if (event.kind === "REOPENED") return `Reopened in ${event.to}`;
  return `Moved to ${event.to}`;
}
function History({ detail }: { detail: DealDetail }) {
  return (
    <section className="crm-pane" aria-label="Stage history">
      <div className="crm-pane-head">
        <h3>Stage history</h3>
      </div>
      <ol className="deal-history">
        {detail.history.map((event) => (
          <li key={event.id} data-kind={event.kind}>
            <span className="deal-history-dot" aria-hidden="true" />
            <div>
              <b>
                {headline(event)}
                {event.from && event.kind !== "CREATED" ? (
                  <span className="crm-muted"> from {event.from}</span>
                ) : null}
              </b>
              <small>
                {event.actor} · {time.format(new Date(event.createdAt))}
                {money(event.amount, event.currency)
                  ? ` · ${money(event.amount, event.currency)}`
                  : ""}
              </small>
              {event.reason && <blockquote>{event.reason}</blockquote>}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

function DealDetails({
  scope,
  detail,
  people,
  readOnly,
  onSave,
}: {
  scope: CrmScope;
  detail: DealDetail;
  people: CrmDirectory["people"];
  readOnly: boolean;
  onSave: (changes: CrmChanges) => void;
}) {
  const deal = detail.deal;
  const amount = useDraft(deal.amount ?? "");
  const notes = useDraft(deal.description);
  const [amountError, setAmountError] = useState<string | null>(null);
  const saveAmount = () => {
    amount.setFocused(false);
    const text = amount.draft.trim().replace(/,/g, "");
    if (text && !/^\d{1,15}(\.\d{1,4})?$/.test(text)) {
      setAmountError("Enter an amount of 0 or more, with up to 4 decimals.");
      return;
    }
    setAmountError(null);
    if ((text || null) !== (deal.amount ?? null))
      onSave({ amount: text || null });
  };
  return (
    <section className="crm-pane crm-details" aria-label="Details">
      <div className="crm-pane-head">
        <h3>Details</h3>
      </div>
      <div className="crm-fields">
        <div className="crm-field" data-wide="">
          <label htmlFor={`amount-${deal.id}`}>Amount</label>
          <div className="deal-money">
            <input
              id={`amount-${deal.id}`}
              inputMode="decimal"
              value={amount.draft}
              readOnly={readOnly}
              placeholder={readOnly ? "Not set" : "Add amount"}
              aria-invalid={Boolean(amountError)}
              data-crm-field=""
              data-dirty={amount.draft !== (deal.amount ?? "") || undefined}
              onFocus={() => amount.setFocused(true)}
              onChange={(event) => amount.setDraft(event.target.value)}
              onBlur={saveAmount}
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
                if (event.key === "Escape") {
                  amount.setDraft(deal.amount ?? "");
                  setAmountError(null);
                  event.currentTarget.blur();
                }
              }}
            />
            <input
              aria-label="Currency"
              defaultValue={deal.currency ?? ""}
              key={deal.currency ?? ""}
              readOnly={readOnly}
              maxLength={3}
              placeholder="PHP"
              onBlur={(event) => {
                const parsed = dealCurrency.safeParse(
                  event.target.value || null,
                );
                if (!parsed.success || parsed.data === (deal.currency ?? null))
                  return;
                onSave({ currency: parsed.data });
              }}
            />
          </div>
          {amountError && (
            <span role="alert" className="crm-field-error">
              {amountError}
            </span>
          )}
        </div>
        <CustomerField
          scope={scope}
          deal={deal}
          readOnly={readOnly}
          onSave={onSave}
        />
        <div className="crm-field">
          <label htmlFor={`close-${deal.id}`}>Expected close</label>
          <input
            id={`close-${deal.id}`}
            type="date"
            defaultValue={deal.expectedCloseDate ?? ""}
            key={deal.expectedCloseDate ?? ""}
            readOnly={readOnly}
            onBlur={(event) => {
              const value = event.target.value || null;
              if (value !== deal.expectedCloseDate) onSave({ dueDate: value });
            }}
          />
        </div>
        <div className="crm-field">
          <label htmlFor={`owner-${deal.id}`}>Owner</label>
          <select
            id={`owner-${deal.id}`}
            value={deal.ownerId ?? ""}
            disabled={readOnly}
            onChange={(event) =>
              onSave({
                assigneeIds: event.target.value ? [event.target.value] : [],
              })
            }
          >
            <option value="">No owner</option>
            {people
              .filter(
                (person) => !person.deactivated || person.id === deal.ownerId,
              )
              .map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                  {person.deactivated ? " (deactivated)" : ""}
                </option>
              ))}
          </select>
        </div>
      </div>
      <div className="crm-notes">
        <label htmlFor={`notes-${deal.id}`}>Notes</label>
        <textarea
          id={`notes-${deal.id}`}
          value={notes.draft}
          readOnly={readOnly}
          maxLength={10000}
          data-crm-field=""
          data-dirty={notes.draft !== deal.description || undefined}
          placeholder="What should teammates know about this deal?"
          onFocus={() => notes.setFocused(true)}
          onChange={(event) => notes.setDraft(event.target.value)}
          onBlur={() => {
            notes.setFocused(false);
            if (notes.draft !== deal.description)
              onSave({ description: notes.draft });
          }}
        />
      </div>
    </section>
  );
}
