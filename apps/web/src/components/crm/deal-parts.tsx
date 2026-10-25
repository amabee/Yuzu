"use client";
import { useEffect, useState } from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { useQueryClient } from "@tanstack/react-query";
import { Building2, ContactRound, X } from "lucide-react";
import {
  categoryLabels,
  needsStageReason,
  stageNeedsApproval,
  type PipelineStageView,
  type PipelineSummary,
  type StageCategory,
} from "@/lib/deal-contract";
import { useUiStore } from "@/components/providers";
import { Initials } from "./crm-parts";
import {
  saveError,
  useCrmPicker,
  useCrmSave,
  type CrmScope,
  type CrmType,
} from "./use-crm";
import {
  dealEntry,
  money,
  moveCachedDeal,
  useCustomerDeals,
  useDecideStageRequest,
  type Deal,
  type DealDetail,
} from "./use-deals";

type Stage = Pick<PipelineStageView, "id" | "name" | "category">;

/** The pipeline as a row of steps; choosing one moves the deal there. */
export function StagePath({
  stages,
  current,
  disabled,
  lockedReason,
  asked,
  onMove,
}: {
  stages: Stage[];
  current: string;
  disabled: boolean;
  /** Why only the current step is available, e.g. a request is waiting. */
  lockedReason: string | null;
  /** The stage a waiting request asks for. */
  asked: string | null;
  onMove: (stageId: string) => void;
}) {
  const here = stages.findIndex((stage) => stage.id === current);
  const open = stages[here]?.category === "OPEN";
  return (
    <nav className="deal-path" aria-label="Stage">
      {stages.map((stage, index) => {
        const isHere = stage.id === current;
        return (
          <button
            key={stage.id}
            type="button"
            className="deal-step"
            data-category={stage.category}
            data-here={isHere || undefined}
            data-asked={stage.id === asked || undefined}
            data-done={
              (open && index < here && stage.category === "OPEN") || undefined
            }
            aria-current={isHere ? "step" : undefined}
            aria-description={
              stage.id === asked ? "Waiting for approval" : undefined
            }
            disabled={disabled || (Boolean(lockedReason) && !isHere)}
            title={lockedReason ?? `Move to ${stage.name}`}
            onClick={() => !isHere && onMove(stage.id)}
          >
            {stage.name}
          </button>
        );
      })}
    </nav>
  );
}

/** Does this move wait for approval on this pipeline? */
export const moveNeedsApproval = (
  pipeline: PipelineSummary | undefined,
  from: Stage,
  to: Stage,
) =>
  Boolean(pipeline?.approvals) &&
  stageNeedsApproval(
    pipeline!.stageApproval,
    from.category as StageCategory,
    to.category as StageCategory,
  );

/**
 * Moves deals between stages. A direct move shows at once; a move that needs
 * approval asks first and becomes a request while the deal stays put. A
 * Won↔Lost move always asks why, and a conflict reloads the latest instead
 * of overwriting it.
 */
export function useStageMove(
  scope: CrmScope,
  pipeline: PipelineSummary | undefined,
  onNotice: (message: string, kind: "success" | "error" | "info") => void,
) {
  const save = useCrmSave(scope);
  const client = useQueryClient();
  const stages = pipeline?.stages ?? [];
  const [asking, setAsking] = useState<{
    deal: Deal;
    target: Stage;
    from: Stage;
    request: boolean;
    reason: boolean;
  } | null>(null);
  const [note, setNote] = useState("");
  const commit = (
    deal: Deal,
    target: Stage,
    from: Stage,
    request: boolean,
    why?: string,
  ) => {
    if (!request) moveCachedDeal(client, scope, deal.id, target.id);
    save.mutate(
      {
        record: deal,
        changes: { stageId: target.id, ...(why ? { stageReason: why } : {}) },
      },
      {
        onSuccess: (result) =>
          onNotice(
            result.outcome === "PENDING_APPROVAL"
              ? `Sent to ${pipeline?.approverName ?? "the approver"} for approval. ${deal.name} stays in ${from.name} until then.`
              : target.category === "WON"
                ? `Won. ${deal.name} is closed as won.`
                : target.category === "LOST"
                  ? `${deal.name} is closed as lost.`
                  : from.category !== "OPEN"
                    ? `Reopened in ${target.name}.`
                    : `Moved to ${target.name}.`,
            result.outcome === "PENDING_APPROVAL" ? "info" : "success",
          ),
        onError: (error) => onNotice(saveError(error), "error"),
      },
    );
  };
  const move = (deal: Deal, stageId: string) => {
    const target = stages.find((stage) => stage.id === stageId);
    const from = stages.find((stage) => stage.id === deal.stageId);
    if (!target || !from || target.id === from.id) return;
    if (deal.request) {
      onNotice(
        deal.request.visible
          ? "This deal already has a stage request waiting. Open it to see where it stands."
          : "A stage change is already pending for this deal.",
        "info",
      );
      return;
    }
    const request = moveNeedsApproval(pipeline, from, target);
    const reason = needsStageReason(
      from.category as StageCategory,
      target.category as StageCategory,
    );
    if (request || reason) {
      setNote("");
      setAsking({ deal, target, from, request, reason });
      return;
    }
    commit(deal, target, from, false);
  };
  const fromLabel = asking
    ? categoryLabels[asking.from.category as StageCategory].toLowerCase()
    : "";
  const toLabel = asking
    ? categoryLabels[asking.target.category as StageCategory].toLowerCase()
    : "";
  const dialog = (
    <DialogPrimitive.Root
      open={Boolean(asking)}
      onOpenChange={(next) => !next && setAsking(null)}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="crm-scrim" style={{ zIndex: 70 }} />
        <DialogPrimitive.Content
          className="deal-dialog"
          aria-describedby="deal-reason-text"
          onCloseAutoFocus={(event) => {
            // A sent request disables the step that opened this; keep focus
            // on the open deal's current stage so Escape still closes it.
            const steps = document.querySelectorAll<HTMLElement>(
              '.deal-path [aria-current="step"]',
            );
            const here = steps[steps.length - 1];
            if (here) {
              event.preventDefault();
              here.focus();
            }
          }}
        >
          {asking && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (asking.reason && !note.trim()) return;
                commit(
                  asking.deal,
                  asking.target,
                  asking.from,
                  asking.request,
                  note.trim() || undefined,
                );
                setAsking(null);
              }}
            >
              <DialogPrimitive.Title className="deal-dialog-title">
                {asking.request ? "Request a move" : "Move"} to{" "}
                {asking.target.name}?
              </DialogPrimitive.Title>
              <p id="deal-reason-text" className="deal-dialog-text">
                {asking.request
                  ? `${pipeline?.approverName ?? "An approver"} approves stage changes on this pipeline. ${asking.deal.name} stays in ${asking.from.name} until then.`
                  : `This deal was ${fromLabel}. Say why it's now ${toLabel}; the reason stays in its history.`}
              </p>
              <label
                className={asking.request ? "deal-label" : "sr-only"}
                htmlFor="deal-reason"
              >
                {!asking.request
                  ? "Reason"
                  : asking.reason
                    ? `Why is it now ${toLabel}?`
                    : "Note for the approver (optional)"}
              </label>
              <textarea
                id="deal-reason"
                autoFocus
                required={asking.reason}
                maxLength={500}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder={
                  asking.reason
                    ? "e.g. The customer cancelled before signing"
                    : "e.g. PO signed, waiting on the countersigned copy"
                }
              />
              <div className="deal-dialog-actions">
                <DialogPrimitive.Close className="crm-button" type="button">
                  Cancel
                </DialogPrimitive.Close>
                <button
                  type="submit"
                  className="crm-button"
                  data-tone="primary"
                  disabled={asking.reason && !note.trim()}
                >
                  {asking.request ? "Send request" : "Move deal"}
                </button>
              </div>
            </form>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
  return { move, dialog, pending: save.isPending };
}

const dismissedKey = (id: string) => `yuzu.stage-request.dismissed.${id}`;
const wasDismissed = (id: string) => {
  try {
    return window.localStorage.getItem(dismissedKey(id)) === "1";
  } catch {
    return false;
  }
};
const closedWords = {
  REJECTED: "was rejected",
  STALE: "needs resubmitting",
  CANCELLED: "was cancelled",
  INVALIDATED: "no longer applies",
  EXPIRED: "expired",
} as const;

/**
 * Under the stage path: a waiting request with the viewer's actions, or the
 * viewer's own request that closed without moving the deal.
 */
export function StageRequestBanner({
  scope,
  detail,
  stages,
  onNotice,
  onResubmit,
}: {
  scope: CrmScope;
  detail: DealDetail;
  stages: Stage[];
  onNotice: (message: string, kind: "success" | "error" | "info") => void;
  onResubmit: (stageId: string) => void;
}) {
  const decide = useDecideStageRequest(scope);
  const [closing, setClosing] = useState<"reject" | "cancel" | null>(null);
  const [reason, setReason] = useState("");
  const [dismissed, setDismissed] = useState<string | null>(null);
  const request = detail.deal.request;
  const name = (id: string) =>
    stages.find((stage) => stage.id === id)?.name ?? "another stage";
  const act = (
    action: "approve" | "reject" | "withdraw" | "cancel",
    why?: string,
  ) =>
    request?.visible &&
    decide.mutate(
      { proposalId: request.id, action, reason: why },
      {
        onSuccess: (result) => {
          setClosing(null);
          setReason("");
          onNotice(
            result.status === "APPROVED"
              ? `Approved. ${detail.deal.name} moved to ${name(request.toStageId)}.`
              : result.status === "REJECTED"
                ? `Request rejected. ${request.authorName} has been told.`
                : result.status === "WITHDRAWN"
                  ? "Request withdrawn."
                  : result.status === "CANCELLED"
                    ? "Request cancelled."
                    : (result.reason ?? "This request can't be decided now."),
            result.status === "APPROVED" ? "success" : "info",
          );
        },
        onError: (error) => onNotice(saveError(error), "error"),
      },
    );
  if (request && !request.visible)
    return (
      <div className="deal-request" data-closed="" role="status">
        <div>
          <b>A stage change is already pending.</b>
          <small>The deal can&apos;t move until it&apos;s resolved.</small>
        </div>
      </div>
    );
  if (request) {
    const mine = request.canWithdraw;
    return (
      <div className="deal-request" role="status">
        <div>
          <b>
            {mine ? "You" : request.authorName} asked to move this deal to{" "}
            {name(request.toStageId)}
          </b>
          <small>
            {new Date(request.createdAt).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
            })}{" "}
            · waiting for{" "}
            {request.canDecide
              ? "you"
              : (request.reviewerName ?? "an approver to be appointed")}{" "}
            · it stays in {name(request.fromStageId)} until then
          </small>
          {request.note && <blockquote>{request.note}</blockquote>}
          {closing && (
            <form
              className="deal-request-reason"
              onSubmit={(event) => {
                event.preventDefault();
                if (reason.trim()) act(closing, reason.trim());
              }}
            >
              <label htmlFor={`request-reason-${request.id}`}>
                {closing === "reject"
                  ? "Why are you rejecting it?"
                  : "Why are you cancelling it?"}
              </label>
              <textarea
                id={`request-reason-${request.id}`}
                autoFocus
                required
                maxLength={500}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
              <span className="deal-request-actions">
                <button
                  type="button"
                  className="crm-button"
                  data-size="sm"
                  onClick={() => setClosing(null)}
                >
                  Back
                </button>
                <button
                  type="submit"
                  className="crm-button"
                  data-size="sm"
                  data-tone="primary"
                  disabled={!reason.trim() || decide.isPending}
                >
                  {closing === "reject" ? "Reject request" : "Cancel request"}
                </button>
              </span>
            </form>
          )}
        </div>
        {!closing && (
          <span className="deal-request-actions">
            {request.canDecide && (
              <>
                <button
                  type="button"
                  className="crm-button"
                  data-size="sm"
                  disabled={decide.isPending}
                  onClick={() => setClosing("reject")}
                >
                  Reject
                </button>
                <button
                  type="button"
                  className="crm-button"
                  data-size="sm"
                  data-tone="primary"
                  disabled={decide.isPending}
                  onClick={() => act("approve")}
                >
                  Approve move
                </button>
              </>
            )}
            {request.canWithdraw && (
              <button
                type="button"
                className="crm-button"
                data-size="sm"
                disabled={decide.isPending}
                onClick={() => act("withdraw")}
              >
                Withdraw
              </button>
            )}
            {request.canCancel && !request.canDecide && (
              <button
                type="button"
                className="crm-button"
                data-size="sm"
                data-tone="danger"
                disabled={decide.isPending}
                onClick={() => setClosing("cancel")}
              >
                Cancel request
              </button>
            )}
            {!request.canDecide &&
              !request.canWithdraw &&
              !request.canCancel && (
                <small>
                  Only {request.reviewerName ?? "an approver"} can decide.
                </small>
              )}
          </span>
        )}
      </div>
    );
  }
  const closed = detail.closedRequest;
  if (!closed || dismissed === closed.id || wasDismissed(closed.id))
    return null;
  return (
    <div className="deal-request" data-closed="" role="status">
      <div>
        <b>
          Your request to move to {closed.toStageName}{" "}
          {closedWords[closed.status]}
        </b>
        {closed.reason && <small>{closed.reason}</small>}
      </div>
      <span className="deal-request-actions">
        <button
          type="button"
          className="crm-button"
          data-size="sm"
          onClick={() => {
            try {
              window.localStorage.setItem(dismissedKey(closed.id), "1");
            } catch {}
            setDismissed(closed.id);
          }}
        >
          Dismiss
        </button>
        {detail.deal.canEdit && (
          <button
            type="button"
            className="crm-button"
            data-size="sm"
            data-tone="primary"
            onClick={() => onResubmit(closed.toStageId)}
          >
            Review and resubmit
          </button>
        )}
      </span>
    </div>
  );
}

/** A deal's one customer: a company or a person, chosen with search. */
export function CustomerField({
  scope,
  deal,
  readOnly,
  onSave,
}: {
  scope: CrmScope;
  deal: Deal;
  readOnly: boolean;
  onSave: (changes: {
    customerCompanyId?: string | null;
    customerContactId?: string | null;
  }) => void;
}) {
  const openRecord = useUiStore((state) => state.openCrmRecord);
  const [picking, setPicking] = useState(false);
  const [kind, setKind] = useState<CrmType>(deal.customer?.type ?? "COMPANY");
  const [q, setQ] = useState("");
  const [settled, setSettled] = useState("");
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(q.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [q]);
  const results = useCrmPicker(scope, kind, settled, picking);
  const customer = deal.customer;
  return (
    <div className="crm-field" data-wide="">
      <span className="deal-label" id={`customer-${deal.id}`}>
        Customer
      </span>
      <div className="deal-customer" aria-labelledby={`customer-${deal.id}`}>
        {customer?.visible ? (
          <button
            type="button"
            className="deal-customer-pill"
            onClick={() => openRecord(customer.id, "stack")}
            aria-label={`Open ${customer.name}`}
          >
            <Initials
              name={customer.name}
              person={customer.type === "CONTACT"}
            />
            {customer.name}
            {customer.archived ? " · Archived" : ""}
          </button>
        ) : customer ? (
          <span className="crm-empty">
            Private {customer.type === "COMPANY" ? "company" : "contact"}
          </span>
        ) : (
          <span className="crm-empty">No customer yet</span>
        )}
        {!readOnly && (
          <span className="deal-customer-tools">
            <button
              type="button"
              className="crm-button"
              data-size="sm"
              aria-expanded={picking}
              onClick={() => setPicking((value) => !value)}
            >
              {customer ? "Change" : "Choose"}
            </button>
            {customer && (
              <button
                type="button"
                className="crm-icon-button"
                aria-label="Remove customer"
                onClick={() =>
                  onSave(
                    customer.type === "COMPANY"
                      ? { customerCompanyId: null }
                      : { customerContactId: null },
                  )
                }
              >
                <X size={14} aria-hidden="true" />
              </button>
            )}
          </span>
        )}
      </div>
      {picking && (
        <div className="crm-picker" role="group" aria-label="Choose a customer">
          <div className="crm-picker-inputs">
            <div
              className="deal-kind"
              role="radiogroup"
              aria-label="Customer type"
            >
              {(["COMPANY", "CONTACT"] as const).map((type) => (
                <button
                  key={type}
                  type="button"
                  role="radio"
                  aria-checked={kind === type}
                  onClick={() => setKind(type)}
                >
                  {type === "COMPANY" ? (
                    <Building2 size={13} aria-hidden="true" />
                  ) : (
                    <ContactRound size={13} aria-hidden="true" />
                  )}
                  {type === "COMPANY" ? "Company" : "Person"}
                </button>
              ))}
            </div>
            <label className="crm-search">
              <input
                autoFocus
                type="search"
                aria-label={`Find a ${kind === "COMPANY" ? "company" : "person"}`}
                placeholder={`Find a ${kind === "COMPANY" ? "company" : "person"}`}
                value={q}
                onChange={(event) => setQ(event.target.value)}
              />
            </label>
          </div>
          <ul className="crm-picker-results" aria-live="polite">
            {(results.data ?? []).slice(0, 8).map((record) => (
              <li key={record.id}>
                <button
                  type="button"
                  onClick={() => {
                    onSave(
                      kind === "COMPANY"
                        ? { customerCompanyId: record.id }
                        : { customerContactId: record.id },
                    );
                    setPicking(false);
                    setQ("");
                  }}
                >
                  <Initials name={record.name} person={kind === "CONTACT"} />
                  <span className="crm-link-name">
                    <b>{record.name}</b>
                    <small>
                      {(kind === "COMPANY"
                        ? (record.profile.domain ?? record.profile.email)
                        : record.profile.email) ?? ""}
                    </small>
                  </span>
                  <span className="crm-picker-add">Choose</span>
                </button>
              </li>
            ))}
            {results.data && !results.data.length && (
              <li className="crm-links-empty">
                {settled
                  ? `No ${kind === "COMPANY" ? "companies" : "people"} match “${settled}”.`
                  : `No ${kind === "COMPANY" ? "companies" : "people"} yet.`}
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

/** Deals a company or person is the customer of; opening one stacks it. */
export function CustomerDealsPane({
  scope,
  recordId,
}: {
  scope: CrmScope;
  recordId: string;
}) {
  const deals = useCustomerDeals(scope, recordId);
  const openRecord = useUiStore((state) => state.openCrmRecord);
  const list = deals.data ?? [];
  return (
    <section className="crm-pane crm-links" aria-label="Deals">
      <div className="crm-pane-head">
        <h3>Deals</h3>
        <span className="crm-count">{deals.data ? list.length : ""}</span>
      </div>
      {deals.isError ? (
        <p className="crm-links-empty" role="alert">
          {saveError(deals.error)}
        </p>
      ) : !deals.data ? (
        <p className="crm-links-empty" aria-busy="true">
          Loading…
        </p>
      ) : !list.length ? (
        <p className="crm-links-empty">
          No deals yet. Choose this record as a deal&apos;s customer to see it
          here.
        </p>
      ) : (
        <ul className="deal-customer-deals">
          {list.map((deal) => (
            <li key={deal.id}>
              <button
                type="button"
                onClick={() => openRecord(dealEntry(deal.id), "stack")}
              >
                <span className="crm-link-name">
                  <b>{deal.name}</b>
                  <small>
                    {deal.pipeline}
                    {deal.archived ? " · Archived" : ""}
                  </small>
                </span>
                <span className="deal-stage-chip" data-category={deal.category}>
                  <i aria-hidden="true" />
                  {deal.stage}
                </span>
                <span className="crm-num">
                  {money(deal.amount, deal.currency) ?? ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
