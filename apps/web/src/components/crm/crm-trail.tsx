"use client";
import { useUiStore } from "@/components/providers";
import { useCrmRecord, type CrmScope } from "./use-crm";
import { dealIdOf, useDeal } from "./use-deals";

/** The open cards, bottom first; each earlier one steps back to it. */
export function TrailItems({
  stack,
  scope,
}: {
  stack: string[];
  scope: CrmScope;
}) {
  const trim = useUiStore((state) => state.trimCrmStack);
  return stack.map((entry, index) => (
    <TrailItem
      key={`${index}:${entry}`}
      entry={entry}
      scope={scope}
      current={index === stack.length - 1}
      onSelect={() => trim(index + 1)}
    />
  ));
}
function TrailItem({
  entry,
  scope,
  current,
  onSelect,
}: {
  entry: string;
  scope: CrmScope;
  current: boolean;
  onSelect: () => void;
}) {
  const dealId = dealIdOf(entry);
  const deal = useDeal(scope, dealId);
  const record = useCrmRecord(scope, dealId ? null : entry);
  const name =
    (dealId ? deal.data?.deal.name : record.data?.record.name) ?? "…";
  return current ? (
    <span className="crm-trail-here" aria-current="page">
      {name}
    </span>
  ) : (
    <>
      <button type="button" onClick={onSelect}>
        {name}
      </button>
      <span aria-hidden="true">›</span>
    </>
  );
}
