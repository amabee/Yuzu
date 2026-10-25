"use client";
import { useEffect, useState } from "react";
import "./crm.css";
import { DropdownMenu } from "radix-ui";
import { Archive, Check, Columns3, FileDown, Search } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { ImportCsv } from "@/components/boards/import-csv";
import { useCsvTransfers } from "@/components/transfers/csv-transfer-runtime";
import { resolveRecordConfig } from "@/lib/record-types";
import { useBoardLiveSync } from "@/components/boards/use-board-live-sync";
import { useTaskUploads } from "@/components/boards/use-task-uploads";
import { useUiStore } from "@/components/providers";
import { YuzuToast, type YuzuToastNotice } from "@/components/ui/yuzu-toast";
import { PageCrumbs } from "@/components/page-crumbs";
import { CRM_PAGE_SIZE, type CrmRecord } from "@/lib/crm-contract";
import { CrmGrid, crmColumns } from "./crm-grid";
import { AddRow } from "./crm-parts";
import { CrmRecordDeck } from "./crm-record-deck";
import {
  crmKeys,
  saveError,
  useCrmCreate,
  useCrmDirectory,
  useCrmLifecycle,
  useCrmSave,
  type CrmChanges,
  type CrmScope,
  type DirectoryQuery,
  type LifecycleAction,
} from "./use-crm";

const copy = {
  COMPANY: {
    title: "Companies",
    lede: "The businesses you work with. Everyone in this workspace shares one list.",
    add: "Add company",
    noun: "company",
    search: "Search name, domain or email",
    empty:
      "No companies yet. Type a name in the last row to add the first one.",
  },
  CONTACT: {
    title: "Contacts",
    lede: "The people you work with, at a company or on their own. A contact doesn't need a company.",
    add: "Add contact",
    noun: "contact",
    search: "Search name or email",
    empty: "No contacts yet. Type a name in the last row to add the first one.",
  },
} as const;

export function CrmDirectoryScreen({
  scope,
  workspaceName,
  initialRecord,
}: {
  scope: CrmScope;
  workspaceName: string;
  initialRecord: string | null;
}) {
  const text = copy[scope.type];
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState<DirectoryQuery>({
    q: "",
    archived: false,
    sort: "name",
    page: 1,
  });
  const [notice, setNotice] = useState<YuzuToastNotice | null>(null);
  const [exporting, setExporting] = useState(false);
  const { startExport } = useCsvTransfers();
  const queryClient = useQueryClient();
  const [familiarSlot, setFamiliarSlot] = useState<HTMLDivElement | null>(null);
  const toast = (message: string, kind: YuzuToastNotice["kind"] = "success") =>
    setNotice({ id: crypto.randomUUID(), kind, message });
  const live = useBoardLiveSync(scope.boardId, scope.principalId);
  // Changes on the other collection (a renamed company, a contact's links,
  // a stacked card of the other type) refresh this screen live as well.
  const related = useBoardLiveSync(
    scope.relatedBoardId,
    scope.principalId,
    crmKeys.board(scope),
  );
  const directory = useCrmDirectory(scope, query, live.syncInterval);
  const save = useCrmSave(scope);
  const create = useCrmCreate(scope);
  const lifecycle = useCrmLifecycle(scope);
  // Uploads keep running when a card closes; their progress stays pinned.
  const [transfers, setTransfers] = useState<Record<string, YuzuToastNotice>>(
    {},
  );
  const transferNotice = (update: YuzuToastNotice) => {
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
  const hidden = useUiStore((state) => state.crmHiddenColumns[scope.type]);
  const toggleColumn = useUiStore((state) => state.toggleCrmColumn);
  const openRecord = useUiStore((state) => state.openCrmRecord);
  const stack = useUiStore((state) => state.crmStack);
  const trim = useUiStore((state) => state.trimCrmStack);

  // Search as people type, without a request per keystroke.
  useEffect(() => {
    const timer = window.setTimeout(
      () =>
        setQuery((current) =>
          current.q === search.trim()
            ? current
            : { ...current, q: search.trim(), page: 1 },
        ),
      250,
    );
    return () => window.clearTimeout(timer);
  }, [search]);
  // The open record lives in the URL, so it can be shared and reloaded.
  useEffect(() => {
    if (initialRecord) openRecord(initialRecord, "fresh");
    return () => trim(0);
  }, [initialRecord, openRecord, trim]);
  const top = stack.at(-1);
  useEffect(() => {
    const url = new URL(window.location.href);
    if ((url.searchParams.get("record") ?? undefined) === top) return;
    if (top) url.searchParams.set("record", top);
    else url.searchParams.delete("record");
    window.history.replaceState(null, "", url);
  }, [top]);

  const onSave = (record: CrmRecord, changes: CrmChanges) =>
    save.mutate(
      { record, changes },
      {
        onSuccess: (result) => {
          if (result.outcome === "PENDING_APPROVAL")
            toast(
              "Sent for approval. It changes once a reviewer approves it.",
              "info",
            );
        },
        onError: (error) => toast(saveError(error), "error"),
      },
    );
  const onCreate = async (name: string) => {
    try {
      const result = await create.mutateAsync({
        name,
        createKey: crypto.randomUUID(),
      });
      toast(
        result.outcome === "PENDING_APPROVAL"
          ? `Sent for approval. The ${text.noun} appears once a reviewer approves it.`
          : `${text.noun.charAt(0).toUpperCase()}${text.noun.slice(1)} added`,
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
        onSuccess: (response) => {
          const outcome = (response.data as { outcome?: string })?.outcome;
          if (outcome === "PENDING_APPROVAL")
            return toast("Sent for approval.", "info");
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

  const data = directory.data;
  const columns = crmColumns(scope.type).filter(
    (column) => column.kind !== "name",
  );
  const first = data && data.total ? (data.page - 1) * CRM_PAGE_SIZE + 1 : 0;
  const last = data ? first + data.records.length - (data.total ? 1 : 0) : 0;
  return (
    <div
      className="crm-page"
      data-connection={live.status}
      data-related-connection={related.status}
    >
      <PageCrumbs
        items={[{ label: "CRM", href: "/crm" }, { label: text.title }]}
      />
      <header className="crm-page-head">
        <div>
          <p className="crm-page-context">{workspaceName}</p>
          <h1>{text.title}</h1>
          <p className="crm-page-lede">{text.lede}</p>
        </div>
        {data && (
          <div className="crm-page-actions">
            <ImportCsv
              state={{
                boardId: scope.boardId,
                readOnly: !data.canCreate,
                record: {
                  ...resolveRecordConfig(scope.type, {}),
                  type: scope.type,
                },
                fields: [],
                groups: [],
                people: data.people,
              }}
              onNotice={transferNotice}
              onChanged={() =>
                void queryClient.invalidateQueries({
                  queryKey: crmKeys.board(scope),
                })
              }
            />
            <button
              type="button"
              className="crm-button"
              data-size="sm"
              disabled={exporting}
              onClick={async () => {
                setExporting(true);
                try {
                  await startExport({
                    boardId: scope.boardId,
                    scope: "BOARD",
                    includeArchived: query.archived,
                  });
                  toast(
                    `Preparing your ${text.title.toLowerCase()} CSV${query.archived ? ", archived ones included" : ""}. Download it from the lemon when it's ready.`,
                    "info",
                  );
                } catch (error) {
                  toast(saveError(error), "error");
                } finally {
                  setExporting(false);
                }
              }}
            >
              <FileDown size={14} aria-hidden="true" />
              {exporting ? "Exporting…" : "Export CSV"}
            </button>
          </div>
        )}
      </header>
      <div
        className="crm-tools"
        role="toolbar"
        aria-label={`${text.title} tools`}
      >
        <label className="crm-search">
          <Search size={15} aria-hidden="true" />
          <input
            type="search"
            aria-label={`Search ${text.title.toLowerCase()}`}
            placeholder={text.search}
            value={search}
            maxLength={200}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <button
          type="button"
          className="crm-chip"
          aria-pressed={query.archived}
          onClick={() =>
            setQuery((current) => ({
              ...current,
              archived: !current.archived,
              page: 1,
            }))
          }
        >
          <Archive size={14} aria-hidden="true" />
          Archived
        </button>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger className="crm-chip">
            <Columns3 size={14} aria-hidden="true" />
            Columns
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              className="crm-menu"
              align="end"
              sideOffset={6}
            >
              <DropdownMenu.Label className="crm-menu-label">
                Show columns
              </DropdownMenu.Label>
              {columns.map((column) => (
                <DropdownMenu.CheckboxItem
                  key={column.key}
                  className="crm-menu-item"
                  checked={!hidden.includes(column.key)}
                  onSelect={(event) => event.preventDefault()}
                  onCheckedChange={() => toggleColumn(scope.type, column.key)}
                >
                  <DropdownMenu.ItemIndicator className="crm-menu-check">
                    <Check size={14} aria-hidden="true" />
                  </DropdownMenu.ItemIndicator>
                  {column.label}
                </DropdownMenu.CheckboxItem>
              ))}
              <p className="crm-menu-note">Drag a column edge to resize it.</p>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>

      <div className="crm-grid-card" aria-busy={directory.isFetching}>
        {directory.isError && !data ? (
          <div className="crm-empty-state" role="alert">
            <b>{text.title} couldn&apos;t load</b>
            <span>{saveError(directory.error)}</span>
            <button
              type="button"
              className="crm-button"
              onClick={() => void directory.refetch()}
            >
              Try again
            </button>
          </div>
        ) : !data ? (
          <div className="crm-empty-state" aria-busy="true">
            <span>Loading {text.title.toLowerCase()}…</span>
          </div>
        ) : (
          <>
            <CrmGrid
              type={scope.type}
              directory={data}
              query={query}
              hidden={hidden}
              onSort={(sort) =>
                setQuery((current) => ({ ...current, sort, page: 1 }))
              }
              onSave={onSave}
              onOpen={(record) => openRecord(record.id, "fresh")}
              onOpenLinked={(id) => openRecord(id, "fresh")}
              onBlocked={(message) => toast(message, "info")}
              addRow={
                query.archived ? null : (
                  <AddRow
                    scope={scope}
                    label={text.add}
                    disabled={data.canCreate ? null : "Adding is paused here"}
                    pending={create.isPending}
                    onCreate={onCreate}
                    onOpen={(id) => openRecord(id, "fresh")}
                    slot={familiarSlot}
                  />
                )
              }
            />
            <div ref={setFamiliarSlot} className="crm-familiar-slot" />
            {data.total === 0 && (
              <p className="crm-grid-empty">
                {query.q
                  ? `No ${text.title.toLowerCase()} match “${query.q}”.`
                  : query.archived
                    ? `No archived ${text.title.toLowerCase()}.`
                    : text.empty}
              </p>
            )}
            <footer className="crm-grid-foot">
              <span>
                {data.total
                  ? `${first.toLocaleString()}–${last.toLocaleString()} of ${data.total.toLocaleString()}`
                  : "0"}{" "}
                {query.archived ? "archived" : ""} {text.title.toLowerCase()}
              </span>
              <span className="crm-keys" aria-hidden="true">
                <kbd>Enter</kbd> edit · <kbd>Tab</kbd> next · <kbd>Esc</kbd>{" "}
                cancel · <kbd>Space</kbd> open
              </span>
              {data.pageCount > 1 && (
                <span className="crm-pager">
                  <button
                    type="button"
                    className="crm-button"
                    data-size="sm"
                    disabled={data.page <= 1}
                    onClick={() =>
                      setQuery((current) => ({
                        ...current,
                        page: data.page - 1,
                      }))
                    }
                  >
                    Previous
                  </button>
                  <span>
                    Page {data.page} of {data.pageCount}
                  </span>
                  <button
                    type="button"
                    className="crm-button"
                    data-size="sm"
                    disabled={data.page >= data.pageCount}
                    onClick={() =>
                      setQuery((current) => ({
                        ...current,
                        page: data.page + 1,
                      }))
                    }
                  >
                    Next
                  </button>
                </span>
              )}
            </footer>
          </>
        )}
      </div>
      {data && (
        <CrmRecordDeck
          scope={scope}
          directory={data}
          syncInterval={live.syncInterval}
          uploads={uploads}
          onSave={onSave}
          onLifecycle={onLifecycle}
          onNotice={(message, kind) => toast(message, kind)}
          onTransferNotice={transferNotice}
        />
      )}
      <YuzuToast notice={notice} pinnedNotices={Object.values(transfers)} />
    </div>
  );
}
