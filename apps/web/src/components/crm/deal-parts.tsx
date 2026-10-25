"use client";
import { useEffect, useState } from "react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { useQueryClient } from "@tanstack/react-query";
import { Building2, ContactRound, X } from "lucide-react";
import {
  categoryLabels,
  needsStageReason,
  type PipelineStageView,
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
  type Deal,
} from "./use-deals";

type Stage = Pick<PipelineStageView, "id" | "name" | "category">;

/** The pipeline as a row of steps; choosing one moves the deal there. */
export function StagePath({
  stages,
  current,
  disabled,
  pausedReason,
  onMove,
}: {
  stages: Stage[];
  current: string;
  disabled: boolean;
  pausedReason: string | null;
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
            data-done={
              (open && index < here && stage.category === "OPEN") || undefined
            }
            aria-current={isHere ? "step" : undefined}
            disabled={disabled || (Boolean(pausedReason) && !isHere)}
            title={pausedReason ?? `Move to ${stage.name}`}
            onClick={() => !isHere && onMove(stage.id)}
          >
            {stage.name}
          </button>
        );
      })}
    </nav>
  );
}

/**
 * Moves deals between stages: the card moves at once, a Won↔Lost move first
 * asks why, and a conflict reloads the latest instead of overwriting it.
 */
export function useStageMove(
  scope: CrmScope,
  stages: Stage[],
  onNotice: (message: string, kind: "success" | "error" | "info") => void,
) {
  const save = useCrmSave(scope);
  const client = useQueryClient();
  const [asking, setAsking] = useState<{
    deal: Deal;
    target: Stage;
    from: Stage;
  } | null>(null);
  const [reason, setReason] = useState("");
  const commit = (deal: Deal, target: Stage, from: Stage, why?: string) => {
    moveCachedDeal(client, scope, deal.id, target.id);
    save.mutate(
      {
        record: deal,
        changes: { stageId: target.id, ...(why ? { stageReason: why } : {}) },
      },
      {
        onSuccess: (result) =>
          onNotice(
            result.outcome === "PENDING_APPROVAL"
              ? "Sent for approval."
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
    if (
      needsStageReason(
        from.category as StageCategory,
        target.category as StageCategory,
      )
    ) {
      setReason("");
      setAsking({ deal, target, from });
      return;
    }
    commit(deal, target, from);
  };
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
        >
          {asking && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (!reason.trim()) return;
                commit(asking.deal, asking.target, asking.from, reason.trim());
                setAsking(null);
              }}
            >
              <DialogPrimitive.Title className="deal-dialog-title">
                Move to {asking.target.name}?
              </DialogPrimitive.Title>
              <p id="deal-reason-text" className="deal-dialog-text">
                This deal was{" "}
                {categoryLabels[
                  asking.from.category as StageCategory
                ].toLowerCase()}
                . Say why it&apos;s now{" "}
                {categoryLabels[
                  asking.target.category as StageCategory
                ].toLowerCase()}
                ; the reason stays in its history.
              </p>
              <label className="sr-only" htmlFor="deal-reason">
                Reason
              </label>
              <textarea
                id="deal-reason"
                autoFocus
                required
                maxLength={500}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="e.g. The customer cancelled before signing"
              />
              <div className="deal-dialog-actions">
                <DialogPrimitive.Close className="crm-button" type="button">
                  Cancel
                </DialogPrimitive.Close>
                <button
                  type="submit"
                  className="crm-button"
                  data-tone="primary"
                  disabled={!reason.trim()}
                >
                  Move deal
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
