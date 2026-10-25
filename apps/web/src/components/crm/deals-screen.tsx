"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Archive, Plus, Search, Settings2 } from "lucide-react";
import "./crm.css";
import { useBoardLiveSync } from "@/components/boards/use-board-live-sync";
import { useTaskUploads } from "@/components/boards/use-task-uploads";
import { useUiStore } from "@/components/providers";
import { YuzuToast, type YuzuToastNotice } from "@/components/ui/yuzu-toast";
import { PageCrumbs } from "@/components/page-crumbs";
import { categoryLabels, type PipelineStageView } from "@/lib/deal-contract";
import { CrmRecordDeck } from "./crm-record-deck";
import { Initials } from "./crm-parts";
import { useStageMove } from "./deal-parts";
import { PipelineSettings } from "./pipeline-settings";
import {
  crmKeys,
  saveError,
  useCrmLifecycle,
  useCrmSave,
  type CrmChanges,
  type CrmScope,
  type LifecycleAction,
} from "./use-crm";
import {
  dealEntry,
  dealIdOf,
  money,
  moneyTotals,
  useCreateDeal,
  useDealLanes,
  useDealList,
  usePipeline,
  type Deal,
  type DealSort,
} from "./use-deals";
import type { CrmRecord } from "@/lib/crm-contract";

type Notice = YuzuToastNotice;
const today = () => new Date().toISOString().slice(0, 10);

/** A pipeline's deals as a board of stages, or as a table. */
export function DealsScreen({
  scope,
  contactsBoardId,
  workspaceName,
  initialDeal,
}: {
  /** boardId is the pipeline; relatedBoardId the Companies collection. */
  scope: CrmScope;
  contactsBoardId: string;
  workspaceName: string;
  initialDeal: string | null;
}) {
  const [view, setView] = useState<"board" | "table">("board");
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [archived, setArchived] = useState(false);
  const [sort, setSort] = useState<DealSort>("position");
  const [page, setPage] = useState(1);
  const [settings, setSettings] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const toast = (message: string, kind: Notice["kind"] = "success") =>
    setNotice({ id: crypto.randomUUID(), kind, message });
  // This pipeline, and the customers its deals point to, refresh live.
  const live = useBoardLiveSync(scope.boardId, scope.principalId);
  useBoardLiveSync(
    scope.relatedBoardId,
    scope.principalId,
    crmKeys.board(scope),
  );
  useBoardLiveSync(contactsBoardId, scope.principalId, crmKeys.board(scope));
  const pipeline = usePipeline(scope, scope.boardId, live.syncInterval);
  const stages = useMemo(() => pipeline.data?.stages ?? [], [pipeline.data]);
  const filter = { q, archived };
  const lanes = useDealLanes(
    scope,
    scope.boardId,
    filter,
    live.syncInterval,
    view === "board",
  );
  const list = useDealList(
    scope,
    scope.boardId,
    { ...filter, sort, page },
    live.syncInterval,
    view === "table",
  );
  const create = useCreateDeal(scope);
  const save = useCrmSave(scope);
  const lifecycle = useCrmLifecycle(scope);
  const mover = useStageMove(scope, stages, toast);
  const openRecord = useUiStore((state) => state.openCrmRecord);
  const stack = useUiStore((state) => state.crmStack);
  const trim = useUiStore((state) => state.trimCrmStack);
  const [transfers, setTransfers] = useState<Record<string, Notice>>({});
  const transferNotice = (update: Notice) => {
    setTransfers((current) => {
      const next = { ...current };
      if (update.kind === "loading" && update.icon === "upload")
        next[update.id] = update;
      else delete next[update.id];
      return next;
    });
    setNotice(update);
  };
  const uploads = useTaskUploads(
    scope.principalId,
    scope.boardId,
    transferNotice,
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setQ(search.trim());
      setPage(1);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    if (initialDeal) openRecord(dealEntry(initialDeal), "fresh");
    return () => trim(0);
  }, [initialDeal, openRecord, trim]);
  // The open deal lives in the URL, so it can be shared and reloaded.
  const topDeal = stack.length ? dealIdOf(stack.at(-1)!) : undefined;
  useEffect(() => {
    if (topDeal === null) return;
    const url = new URL(window.location.href);
    if ((url.searchParams.get("record") ?? undefined) === topDeal) return;
    if (topDeal) url.searchParams.set("record", topDeal);
    else url.searchParams.delete("record");
    window.history.replaceState(null, "", url);
  }, [topDeal]);

  const paused = Boolean(pipeline.data?.approvals);
  const people = lanes.data?.people ?? list.data?.people ?? [];
  const open = stages.filter((stage) => stage.category === "OPEN");
  const won = stages.filter((stage) => stage.category === "WON");
  const openCount = open.reduce((count, stage) => count + stage.count, 0);
  const sum = (items: PipelineStageView[]) => {
    const totals: Record<string, number> = {};
    for (const stage of items)
      for (const [currency, amount] of Object.entries(stage.totals))
        totals[currency] = (totals[currency] ?? 0) + Number(amount);
    return moneyTotals(
      Object.fromEntries(
        Object.entries(totals).map(([currency, value]) => [
          currency,
          String(value),
        ]),
      ),
    );
  };
  const addDeal = async (name: string, stageId: string) => {
    try {
      const result = await create.mutateAsync({
        boardId: scope.boardId,
        name,
        stageId,
      });
      toast(
        result.outcome === "PENDING_APPROVAL"
          ? "Sent for approval. The deal appears once a reviewer approves it."
          : "Deal added",
        result.outcome === "PENDING_APPROVAL" ? "info" : "success",
      );
      return true;
    } catch (error) {
      toast(saveError(error), "error");
      return false;
    }
  };
  const onLifecycle = (
    action: LifecycleAction,
    record: { id: string; revision: number },
  ) =>
    lifecycle.mutate(
      { action, record },
      {
        onSuccess: () => {
          if (action === "delete") trim(Math.max(0, stack.length - 1));
          toast(
            action === "archive"
              ? "Archived. Find it under Archived."
              : action === "restore"
                ? "Restored"
                : "Moved to Trash. Admins can restore it from Trash.",
          );
        },
        onError: (error) => toast(saveError(error), "error"),
      },
    );
  const onSave = (record: CrmRecord, changes: CrmChanges) =>
    save.mutate(
      { record, changes },
      { onError: (error) => toast(saveError(error), "error") },
    );

  return (
    <div className="crm-page" data-connection={live.status}>
      <PageCrumbs
        items={[
          { label: "CRM", href: "/crm" },
          { label: "Deals", href: "/crm/deals" },
          { label: pipeline.data?.name ?? "Pipeline" },
        ]}
      />
      <header className="crm-page-head">
        <div>
          <p className="crm-page-context">{workspaceName}</p>
          <h1>{pipeline.data?.name ?? "Pipeline"}</h1>
          {pipeline.data && (
            <p className="deal-sums">
              <span>
                Open <b>{openCount}</b> {openCount === 1 ? "deal" : "deals"}
              </span>
              <span>
                Pipeline <b>{sum(open) || "No value yet"}</b>
              </span>
              <span>
                Won <b>{sum(won) || "—"}</b>
              </span>
            </p>
          )}
        </div>
        <div className="crm-page-actions">
          {pipeline.data?.canManage && (
            <button
              type="button"
              className="crm-button"
              data-size="sm"
              onClick={() => setSettings(true)}
            >
              <Settings2 size={14} aria-hidden="true" />
              Pipeline settings
            </button>
          )}
          <button
            type="button"
            className="crm-button"
            data-size="sm"
            data-tone="primary"
            disabled={!pipeline.data || pipeline.data.archived}
            onClick={() => {
              setView("board");
              setArchived(false);
              setAdding(pipeline.data!.defaultStageId);
            }}
          >
            <Plus size={14} aria-hidden="true" />
            New deal
          </button>
        </div>
      </header>
      <div className="crm-tools" role="toolbar" aria-label="Deal tools">
        <div className="deal-views" role="tablist" aria-label="View">
          {(["board", "table"] as const).map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={view === key}
              onClick={() => setView(key)}
            >
              {key === "board" ? "Board" : "Table"}
            </button>
          ))}
        </div>
        <label className="crm-search">
          <Search size={15} aria-hidden="true" />
          <input
            type="search"
            aria-label="Search deals"
            placeholder="Search deals"
            value={search}
            maxLength={200}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <button
          type="button"
          className="crm-chip"
          aria-pressed={archived}
          onClick={() => {
            setArchived((value) => !value);
            setPage(1);
          }}
        >
          <Archive size={14} aria-hidden="true" />
          Archived
        </button>
      </div>
      {paused && (
        <p className="crm-notice" role="status">
          <span>
            <b>Stage moves are paused on this pipeline.</b> It has approvals
            turned on, and approval for stage changes isn&apos;t available yet.
            Amounts, owners and other fields still follow the approval rules.
          </span>
        </p>
      )}
      {pipeline.isError ? (
        <div className="crm-empty-state" role="alert">
          <b>This pipeline couldn&apos;t load</b>
          <span>{saveError(pipeline.error)}</span>
        </div>
      ) : view === "board" ? (
        <section
          className="deal-board"
          aria-label="Deals by stage"
          aria-busy={lanes.isFetching}
        >
          {stages.map((stage) => (
            <Lane
              key={stage.id}
              stage={stage}
              isDefault={stage.id === pipeline.data?.defaultStageId}
              lane={lanes.data?.lanes.find((lane) => lane.stageId === stage.id)}
              people={people}
              paused={paused}
              archived={archived}
              adding={adding === stage.id}
              canAdd={
                stage.category === "OPEN" &&
                !archived &&
                !pipeline.data?.archived &&
                (!paused || stage.id === pipeline.data?.defaultStageId)
              }
              onAdd={() => setAdding(stage.id)}
              onCancelAdd={() => setAdding(null)}
              onCreate={(name) => addDeal(name, stage.id)}
              onOpen={(deal) => openRecord(dealEntry(deal.id), "fresh")}
              onDrop={(id) => {
                const deal = lanes.data?.lanes
                  .flatMap((lane) => lane.deals)
                  .find((item) => item.id === id);
                if (deal) mover.move(deal, stage.id);
              }}
            />
          ))}
        </section>
      ) : (
        <DealTable
          deals={list.data?.deals ?? []}
          total={list.data?.total ?? 0}
          page={list.data?.page ?? 1}
          pageCount={list.data?.pageCount ?? 0}
          loading={!list.data}
          stages={stages}
          people={people}
          sort={sort}
          paused={paused}
          onSort={(next) => {
            setSort(next);
            setPage(1);
          }}
          onPage={setPage}
          onOpen={(deal) => openRecord(dealEntry(deal.id), "fresh")}
          onStage={(deal, stageId) => mover.move(deal, stageId)}
        />
      )}
      {pipeline.data && (
        <PipelineSettings
          scope={scope}
          pipeline={pipeline.data}
          open={settings}
          onOpenChange={setSettings}
        />
      )}
      <CrmRecordDeck
        scope={scope}
        directory={{
          people,
          records: [],
          canManage: Boolean(pipeline.data?.canManage),
          approvals: false,
        }}
        syncInterval={live.syncInterval}
        uploads={uploads}
        onSave={onSave}
        onLifecycle={onLifecycle}
        onNotice={(message, kind) => toast(message, kind)}
        onTransferNotice={transferNotice}
      />
      {mover.dialog}
      <YuzuToast notice={notice} pinnedNotices={Object.values(transfers)} />
    </div>
  );
}

function DealCardView({
  deal,
  stage,
  people,
  paused,
  onOpen,
}: {
  deal: Deal;
  stage: PipelineStageView;
  people: { id: string; name: string }[];
  paused: boolean;
  onOpen: () => void;
}) {
  const late =
    stage.category === "OPEN" &&
    deal.expectedCloseDate !== null &&
    deal.expectedCloseDate < today();
  const owner = people.find((person) => person.id === deal.ownerId);
  const value = money(deal.amount, deal.currency);
  return (
    <button
      type="button"
      className="deal-tile"
      draggable={deal.canEdit && !paused}
      onDragStart={(event) => {
        event.dataTransfer.setData("application/x-yuzu-deal", deal.id);
        event.dataTransfer.effectAllowed = "move";
      }}
      onClick={onOpen}
      aria-label={`${deal.name}${value ? `, ${value}` : ""}`}
    >
      <span className="deal-tile-name">{deal.name}</span>
      {value && <span className="deal-tile-amount">{value}</span>}
      <span className="deal-tile-meta">
        {deal.customer?.visible ? (
          <span className="deal-customer-pill" data-size="sm">
            <Initials
              name={deal.customer.name}
              person={deal.customer.type === "CONTACT"}
            />
            {deal.customer.name}
          </span>
        ) : deal.customer ? (
          <span>Private customer</span>
        ) : (
          <span>No customer</span>
        )}
        {deal.closedAt ? (
          <span>Closed {new Date(deal.closedAt).toLocaleDateString()}</span>
        ) : deal.expectedCloseDate ? (
          <span data-late={late || undefined}>
            {late ? "Overdue · " : "Close "}
            {new Date(`${deal.expectedCloseDate}T00:00:00`).toLocaleDateString(
              undefined,
              { month: "short", day: "numeric" },
            )}
          </span>
        ) : null}
        {owner && (
          <span className="crm-avatar" title={owner.name} aria-hidden="true">
            {owner.name
              .split(/\s+/)
              .slice(0, 2)
              .map((part) => part[0])
              .join("")
              .toUpperCase()}
          </span>
        )}
      </span>
    </button>
  );
}

function Lane({
  stage,
  isDefault,
  lane,
  people,
  paused,
  archived,
  adding,
  canAdd,
  onAdd,
  onCancelAdd,
  onCreate,
  onOpen,
  onDrop,
}: {
  stage: PipelineStageView;
  isDefault: boolean;
  lane?: { total: number; deals: Deal[] };
  people: { id: string; name: string }[];
  paused: boolean;
  archived: boolean;
  adding: boolean;
  canAdd: boolean;
  onAdd: () => void;
  onCancelAdd: () => void;
  onCreate: (name: string) => Promise<boolean>;
  onOpen: (deal: Deal) => void;
  onDrop: (dealId: string) => void;
}) {
  const [over, setOver] = useState(false);
  const [name, setName] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (adding) input.current?.focus();
  }, [adding]);
  const deals = lane?.deals ?? [];
  const totals = moneyTotals(stage.totals);
  return (
    <div
      className="deal-lane"
      data-category={stage.category}
      data-over={over || undefined}
      role="group"
      aria-label={`${stage.name}, ${categoryLabels[stage.category]}`}
      onDragOver={(event) => {
        if (paused || archived) return;
        if (!event.dataTransfer.types.includes("application/x-yuzu-deal"))
          return;
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setOver(false);
        const id = event.dataTransfer.getData("application/x-yuzu-deal");
        if (id) onDrop(id);
      }}
    >
      <header>
        <h2>
          <i aria-hidden="true" />
          {stage.name}
          {isDefault && <span className="deal-default-tag">Default</span>}
          <small>{lane?.total ?? stage.count}</small>
        </h2>
        <p>{archived ? "Archived deals" : totals || "No value yet"}</p>
      </header>
      <div className="deal-lane-cards">
        {deals.map((deal) => (
          <DealCardView
            key={deal.id}
            deal={deal}
            stage={stage}
            people={people}
            paused={paused}
            onOpen={() => onOpen(deal)}
          />
        ))}
        {!deals.length && (
          <p className="deal-lane-empty">
            {stage.category === "WON"
              ? "Won deals land here."
              : stage.category === "LOST"
                ? "Lost deals land here."
                : "No deals in this stage."}
          </p>
        )}
        {lane && lane.total > deals.length && (
          <p className="deal-lane-empty">
            {lane.total - deals.length} more · use the table to see them all
          </p>
        )}
      </div>
      {canAdd && (
        <footer>
          {adding ? (
            <form
              onSubmit={async (event) => {
                event.preventDefault();
                const value = name.trim();
                if (value && (await onCreate(value))) {
                  setName("");
                  input.current?.focus();
                }
              }}
            >
              <input
                ref={input}
                aria-label={`New deal in ${stage.name}`}
                placeholder="Deal name, then Enter"
                maxLength={200}
                value={name}
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    setName("");
                    onCancelAdd();
                  }
                }}
                onBlur={() => !name.trim() && onCancelAdd()}
              />
            </form>
          ) : (
            <button type="button" onClick={onAdd}>
              + Add deal
            </button>
          )}
        </footer>
      )}
    </div>
  );
}

const columns: { key: string; label: string; sort?: DealSort }[] = [
  { key: "name", label: "Deal", sort: "name" },
  { key: "stage", label: "Stage" },
  { key: "amount", label: "Amount", sort: "-amount" },
  { key: "customer", label: "Customer" },
  { key: "close", label: "Expected close", sort: "close" },
  { key: "owner", label: "Owner" },
];
function DealTable({
  deals,
  total,
  page,
  pageCount,
  loading,
  stages,
  people,
  sort,
  paused,
  onSort,
  onPage,
  onOpen,
  onStage,
}: {
  deals: Deal[];
  total: number;
  page: number;
  pageCount: number;
  loading: boolean;
  stages: PipelineStageView[];
  people: { id: string; name: string }[];
  sort: DealSort;
  paused: boolean;
  onSort: (sort: DealSort) => void;
  onPage: (page: number) => void;
  onOpen: (deal: Deal) => void;
  onStage: (deal: Deal, stageId: string) => void;
}) {
  return (
    <div className="crm-grid-card">
      <div className="crm-grid-scroll">
        <table className="crm-grid deal-table" aria-label="Deals">
          <thead>
            <tr>
              {columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  aria-sort={
                    column.sort && sort === column.sort
                      ? "ascending"
                      : undefined
                  }
                >
                  {column.sort ? (
                    <button
                      type="button"
                      className="crm-th"
                      onClick={() =>
                        onSort(sort === column.sort ? "position" : column.sort!)
                      }
                    >
                      {column.label}
                      {sort === column.sort ? " ↓" : ""}
                    </button>
                  ) : (
                    <span className="crm-th">{column.label}</span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {deals.map((deal) => (
              <tr
                key={deal.id}
                data-archived={deal.archivedAt ? "" : undefined}
              >
                <td>
                  <button
                    type="button"
                    className="deal-row-open"
                    onClick={() => onOpen(deal)}
                  >
                    {deal.name}
                  </button>
                </td>
                <td>
                  <select
                    className="deal-stage-select"
                    aria-label={`Stage of ${deal.name}`}
                    value={deal.stageId}
                    disabled={!deal.canEdit || paused}
                    data-category={
                      stages.find((stage) => stage.id === deal.stageId)
                        ?.category
                    }
                    onChange={(event) => onStage(deal, event.target.value)}
                  >
                    {stages.map((stage) => (
                      <option key={stage.id} value={stage.id}>
                        {stage.name}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="crm-num">
                  {money(deal.amount, deal.currency) ?? (
                    <span className="crm-empty">—</span>
                  )}
                </td>
                <td>
                  {deal.customer?.visible ? (
                    deal.customer.name
                  ) : deal.customer ? (
                    "Private customer"
                  ) : (
                    <span className="crm-empty">—</span>
                  )}
                </td>
                <td>
                  {deal.expectedCloseDate ?? (
                    <span className="crm-empty">—</span>
                  )}
                </td>
                <td>
                  {people.find((person) => person.id === deal.ownerId)
                    ?.name ?? <span className="crm-empty">No owner</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {loading ? (
        <p className="crm-grid-empty">Loading deals…</p>
      ) : !deals.length ? (
        <p className="crm-grid-empty">No deals match.</p>
      ) : null}
      <footer className="crm-grid-foot">
        <span>
          {total.toLocaleString()} {total === 1 ? "deal" : "deals"}
        </span>
        {pageCount > 1 && (
          <span className="crm-pager">
            <button
              type="button"
              className="crm-button"
              data-size="sm"
              disabled={page <= 1}
              onClick={() => onPage(page - 1)}
            >
              Previous
            </button>
            <span>
              Page {page} of {pageCount}
            </span>
            <button
              type="button"
              className="crm-button"
              data-size="sm"
              disabled={page >= pageCount}
              onClick={() => onPage(page + 1)}
            >
              Next
            </button>
          </span>
        )}
      </footer>
    </div>
  );
}
