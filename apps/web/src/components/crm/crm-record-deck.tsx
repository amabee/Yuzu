"use client";
import { useState, type KeyboardEvent } from "react";
import { Dialog as DialogPrimitive, DropdownMenu } from "radix-ui";
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  Ellipsis,
  Trash2,
  X,
} from "lucide-react";
import {
  profileKeysFor,
  profileLabel,
  profileSchemas,
  type CrmDirectory,
  type CrmRecord,
  type CrmRecordDetail,
  type ProfileKey,
} from "@/lib/crm-contract";
import { TaskComments } from "@/components/boards/task-comments";
import { TaskFiles } from "@/components/boards/task-files";
import type { TaskUploads } from "@/components/boards/use-task-uploads";
import type { TransferNoticeHandler } from "@/components/ui/yuzu-toast";
import { useUiStore } from "@/components/providers";
import {
  useCrmRecord,
  type CrmChanges,
  type CrmScope,
  type LifecycleAction,
} from "./use-crm";
import { Initials } from "./crm-parts";
import { CrmLinksPane } from "./crm-links";
import { TrailItems } from "./crm-trail";
import { NameField, useDraft } from "./crm-fields";
import { DealCard } from "./deal-card";
import { CustomerDealsPane } from "./deal-parts";
import { dealIdOf } from "./use-deals";

type Handlers = {
  onSave: (record: CrmRecord, changes: CrmChanges) => void;
  onLifecycle: (
    action: LifecycleAction,
    record: { id: string; revision: number },
  ) => void;
  onNotice: (message: string, kind: "success" | "error" | "info") => void;
  onTransferNotice: TransferNoticeHandler;
};
/** What a card needs from the screen it opens over. */
export type DeckContext = Pick<
  CrmDirectory,
  "people" | "records" | "canManage" | "approvals"
>;

/**
 * Records open as large cards over the directory. Opening a linked record
 * from inside a card stacks it on top, with the earlier cards peeking out
 * behind and a trail back to each one; Escape steps back one card.
 */
export function CrmRecordDeck({
  scope,
  directory,
  syncInterval,
  uploads,
  ...handlers
}: {
  scope: CrmScope;
  directory: DeckContext;
  syncInterval: number;
  uploads: TaskUploads;
} & Handlers) {
  const stack = useUiStore((state) => state.crmStack);
  const trim = useUiStore((state) => state.trimCrmStack);
  const open = stack.length > 0;
  // Escape keeps unsaved typing (the field reverts it); otherwise it closes.
  const editingField = () => {
    const field = document.activeElement;
    if (
      !(
        field instanceof HTMLInputElement ||
        field instanceof HTMLTextAreaElement
      )
    )
      return false;
    return field.dataset.crmField !== undefined
      ? field.dataset.dirty !== undefined
      : field.value.trim() !== "";
  };
  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) trim(0);
      }}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="crm-scrim" />
        <DialogPrimitive.Content
          className="crm-deck"
          aria-describedby={undefined}
          // Focus the card, not its first field, so phones don't open a keyboard.
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            (event.currentTarget as HTMLElement | null)?.focus();
          }}
          // Toasts are layers too and would take Escape from the dialog, so
          // the card handles it: unsaved typing first, then one card back.
          onEscapeKeyDown={(event) => event.preventDefault()}
          onKeyDown={(event) => {
            if (
              event.key !== "Escape" ||
              !event.currentTarget.contains(event.target as Node) ||
              editingField()
            )
              return;
            event.preventDefault();
            trim(stack.length - 1);
          }}
        >
          {stack.map((id, index) => {
            const dealId = dealIdOf(id);
            // Keyed by position: stepping to the next record keeps the card,
            // its tab and the focused button in place.
            return dealId ? (
              <DealCard
                key={`${index}:deal`}
                dealId={dealId}
                depth={stack.length - 1 - index}
                stack={stack}
                scope={scope}
                people={directory.people}
                syncInterval={syncInterval}
                uploads={uploads}
                onNotice={handlers.onNotice}
                onTransferNotice={handlers.onTransferNotice}
                onLifecycle={handlers.onLifecycle}
              />
            ) : (
              <RecordCard
                key={index}
                id={id}
                depth={stack.length - 1 - index}
                stack={stack}
                scope={scope}
                directory={directory}
                syncInterval={syncInterval}
                uploads={uploads}
                {...handlers}
              />
            );
          })}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

const tabs = [
  ["overview", "Overview"],
  ["files", "Files"],
  ["activity", "Activity log"],
] as const;
type Tab = (typeof tabs)[number][0];

function RecordCard({
  id,
  depth,
  stack,
  scope,
  directory,
  syncInterval,
  uploads,
  onSave,
  onLifecycle,
  onNotice,
  onTransferNotice,
}: {
  id: string;
  depth: number;
  stack: string[];
  scope: CrmScope;
  directory: DeckContext;
  syncInterval: number;
  uploads: TaskUploads;
} & Handlers) {
  const [tab, setTab] = useState<Tab>("overview");
  const query = useCrmRecord(scope, id);
  const openRecord = useUiStore((state) => state.openCrmRecord);
  const trim = useUiStore((state) => state.trimCrmStack);
  const detail = query.data;
  const top = depth === 0;
  const record = detail?.record;
  // A stacked card can hold the other type: a contact over Companies.
  const type = detail?.type ?? scope.type;
  const person = type === "CONTACT";
  const sameType = type === scope.type;
  const index = sameType
    ? directory.records.findIndex((item) => item.id === id)
    : -1;
  const neighbour = (step: number) => directory.records[index + step];
  const noun = person ? "contact" : "company";
  const readOnly = !record || !record.canEdit;
  return (
    <article
      className="crm-card"
      data-depth={Math.min(depth, 3)}
      aria-hidden={top ? undefined : true}
      inert={!top}
      aria-label={record?.name ?? `Loading ${noun}`}
    >
      <header className="crm-card-head">
        <Initials name={record?.name ?? ""} person={person} size="lg" />
        <div className="crm-card-who">
          <p className="crm-card-kind">
            {person ? "Contact" : "Company"}
            {record &&
              ` · ${(person ? record.profile.email : record.profile.domain) ?? (person ? "No email" : "No domain")}`}
            {record?.archivedAt && (
              <span className="crm-tag">Archived · read-only</span>
            )}
          </p>
          {top ? (
            <>
              <DialogPrimitive.Title className="sr-only">
                {record?.name ?? `Loading ${noun}`}
              </DialogPrimitive.Title>
              <NameField
                label={person ? "Full name" : "Company name"}
                record={record}
                readOnly={readOnly}
                onSave={(name) => record && onSave(record, { name })}
              />
            </>
          ) : (
            <h2 className="crm-card-name">{record?.name}</h2>
          )}
        </div>
        <div className="crm-card-tools">
          <span className="crm-card-steps">
            <button
              type="button"
              className="crm-icon-button"
              aria-label={`Previous ${noun}`}
              disabled={index <= 0}
              onClick={() => openRecord(neighbour(-1)!.id, "replace")}
            >
              <ChevronUp size={16} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="crm-icon-button"
              aria-label={`Next ${noun}`}
              disabled={index < 0 || index >= directory.records.length - 1}
              onClick={() => openRecord(neighbour(1)!.id, "replace")}
            >
              <ChevronDown size={16} aria-hidden="true" />
            </button>
          </span>
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
          {record && (
            <RecordMenu
              record={record}
              canManage={directory.canManage}
              onAction={(action) => onLifecycle(action, record)}
            />
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
      <div className="crm-card-tabs" role="tablist" aria-label="Record views">
        {tabs.map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            id={`crm-tab-${id}-${key}`}
            aria-selected={tab === key}
            aria-controls={`crm-panel-${id}`}
            onClick={() => setTab(key)}
          >
            {label}
            {key === "files" && record?.attachmentCount ? (
              <span className="crm-count">{record.attachmentCount}</span>
            ) : null}
          </button>
        ))}
      </div>
      <div
        className="crm-card-body"
        id={`crm-panel-${id}`}
        role="tabpanel"
        aria-labelledby={`crm-tab-${id}-${tab}`}
        data-view={tab}
      >
        {query.isError ? (
          <div className="crm-empty-state" role="alert">
            <b>This record isn&apos;t available</b>
            <span>
              It may have been moved to Trash, or your access changed.
            </span>
          </div>
        ) : !detail || !record ? (
          <div className="crm-empty-state" aria-busy="true">
            <span>Loading…</span>
          </div>
        ) : tab === "overview" ? (
          <>
            <div className="crm-card-main">
              <CrmLinksPane
                scope={scope}
                recordId={record.id}
                side={type}
                archived={Boolean(record.archivedAt)}
                syncInterval={syncInterval}
                onNotice={onNotice}
              />
              <CustomerDealsPane scope={scope} recordId={record.id} />
              <section className="crm-pane crm-updates" aria-label="Updates">
                <div className="crm-updates-feed">
                  <TaskComments
                    state={{
                      boardId: scope.boardId,
                      currentUserId: scope.principalId,
                      people: directory.people,
                      readOnly: false,
                    }}
                    task={{
                      id: record.id,
                      archivedAt: record.archivedAt,
                      commentCount: record.commentCount,
                    }}
                    active={top}
                    syncInterval={syncInterval}
                    onNotice={onNotice}
                  />
                </div>
              </section>
            </div>
            <Details
              detail={detail}
              people={directory.people}
              readOnly={readOnly}
              approvals={sameType && directory.approvals}
              onSave={(changes) => onSave(record, changes)}
            />
          </>
        ) : tab === "files" ? (
          <section className="crm-pane crm-wide" aria-label="Files">
            <TaskFiles
              state={{
                boardId: scope.boardId,
                currentUserId: scope.principalId,
              }}
              task={{ id: record.id, archivedAt: record.archivedAt }}
              active={top}
              syncInterval={syncInterval}
              onNotice={onNotice}
              onTransferNotice={onTransferNotice}
              uploads={uploads}
            />
          </section>
        ) : (
          <ActivityLog detail={detail} />
        )}
      </div>
    </article>
  );
}

function RecordMenu({
  record,
  canManage,
  onAction,
}: {
  record: CrmRecord;
  canManage: boolean;
  onAction: (action: LifecycleAction) => void;
}) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        className="crm-icon-button"
        aria-label="More actions"
      >
        <Ellipsis size={16} aria-hidden="true" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className="crm-menu" align="end" sideOffset={6}>
          {record.archivedAt ? (
            <DropdownMenu.Item
              className="crm-menu-item"
              disabled={!canManage}
              onSelect={() => onAction("restore")}
            >
              <ArchiveRestore size={15} aria-hidden="true" />
              Restore
              {!canManage && <small>Managers restore records</small>}
            </DropdownMenu.Item>
          ) : (
            <DropdownMenu.Item
              className="crm-menu-item"
              disabled={!record.canEdit}
              onSelect={() => onAction("archive")}
            >
              <Archive size={15} aria-hidden="true" />
              Archive
            </DropdownMenu.Item>
          )}
          <DropdownMenu.Item
            className="crm-menu-item"
            data-danger=""
            disabled={!canManage}
            onSelect={() => onAction("delete")}
          >
            <Trash2 size={15} aria-hidden="true" />
            Move to Trash
            {!canManage && <small>Managers and admins delete records</small>}
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/** Labelled boxes, each saved on its own when it loses focus. */
function Details({
  detail,
  people,
  readOnly,
  approvals,
  onSave,
}: {
  detail: CrmRecordDetail;
  people: CrmDirectory["people"];
  readOnly: boolean;
  approvals: boolean;
  onSave: (changes: CrmChanges) => void;
}) {
  const { record, type } = detail;
  const keys = profileKeysFor[type];
  return (
    <section className="crm-pane crm-details" aria-label="Details">
      <div className="crm-pane-head">
        <h3>Details</h3>
        {approvals && (
          <span className="crm-hint">Some changes may need approval</span>
        )}
      </div>
      <div className="crm-fields">
        {keys.map((key) => (
          <ProfileField
            key={key}
            id={`${record.id}-${key}`}
            label={profileLabel(type, key)}
            field={key}
            value={record.profile[key]}
            readOnly={readOnly}
            wide={key === "address"}
            onSave={(value) => onSave({ [key]: value })}
          />
        ))}
        <div className="crm-field">
          <label htmlFor={`${record.id}-owner`}>Owner</label>
          <select
            id={`${record.id}-owner`}
            value={record.ownerId ?? ""}
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
                (person) => !person.deactivated || person.id === record.ownerId,
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
      <NotesField
        id={`${record.id}-notes`}
        value={record.description}
        readOnly={readOnly}
        person={type === "CONTACT"}
        onSave={(description) => onSave({ description })}
      />
    </section>
  );
}

function ProfileField({
  id,
  label,
  field,
  value,
  readOnly,
  wide,
  onSave,
}: {
  id: string;
  label: string;
  field: ProfileKey;
  value: string | null;
  readOnly: boolean;
  wide: boolean;
  onSave: (value: string | null) => void;
}) {
  const { draft, setDraft, setFocused } = useDraft(value ?? "");
  const [error, setError] = useState<string | null>(null);
  const commit = () => {
    setFocused(false);
    const parsed = profileSchemas[field].safeParse(draft);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Check this value.");
      return;
    }
    setError(null);
    if ((parsed.data ?? "") !== (value ?? "")) onSave(parsed.data);
  };
  const keys = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Enter" && field !== "address") {
      event.preventDefault();
      event.currentTarget.blur();
    }
    if (event.key === "Escape") {
      setDraft(value ?? "");
      setError(null);
      event.currentTarget.blur();
    }
  };
  const common = {
    id,
    "data-crm-field": "",
    "data-dirty": draft !== (value ?? "") || undefined,
    value: draft,
    readOnly,
    placeholder: readOnly ? "Not set" : `Add ${label.toLowerCase()}`,
    "aria-invalid": Boolean(error),
    "aria-describedby": error ? `${id}-error` : undefined,
    onFocus: () => setFocused(true),
    onBlur: commit,
    onKeyDown: keys,
  };
  return (
    <div className="crm-field" data-wide={wide || undefined}>
      <label htmlFor={id}>{label}</label>
      {field === "address" ? (
        <textarea
          {...common}
          rows={2}
          onChange={(event) => setDraft(event.target.value)}
        />
      ) : (
        <input
          {...common}
          type={
            field === "email" ? "email" : field === "website" ? "url" : "text"
          }
          data-link={
            ["email", "website", "domain"].includes(field) || undefined
          }
          onChange={(event) => setDraft(event.target.value)}
        />
      )}
      {error && (
        <span id={`${id}-error`} role="alert" className="crm-field-error">
          {error}
        </span>
      )}
    </div>
  );
}

function NotesField({
  id,
  value,
  readOnly,
  person,
  onSave,
}: {
  id: string;
  value: string;
  readOnly: boolean;
  person: boolean;
  onSave: (value: string) => void;
}) {
  const { draft, setDraft, setFocused } = useDraft(value);
  return (
    <div className="crm-notes">
      <label htmlFor={id}>Notes</label>
      <textarea
        id={id}
        data-crm-field=""
        data-dirty={draft !== value || undefined}
        value={draft}
        readOnly={readOnly}
        maxLength={10000}
        placeholder={`What should teammates know about this ${person ? "person" : "company"}?`}
        onFocus={() => setFocused(true)}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          setFocused(false);
          if (draft !== value) onSave(draft);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setDraft(value);
            event.currentTarget.blur();
          }
        }}
      />
    </div>
  );
}

function ActivityLog({ detail }: { detail: CrmRecordDetail }) {
  const time = new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
  return (
    <section className="crm-pane crm-wide" aria-label="Activity log">
      <div className="crm-pane-head">
        <h3>Activity log</h3>
        <span className="crm-count">{detail.activity.length}</span>
      </div>
      <ol className="crm-log">
        {detail.activity.map((entry) => (
          <li key={entry.id}>
            <span className="crm-log-dot" aria-hidden="true" />
            <div>
              <p>
                <b>{entry.actor}</b>{" "}
                {entry.changes.length
                  ? `changed ${entry.changes.map((change) => change.field.toLowerCase()).join(", ")}`
                  : entry.action.toLowerCase()}
                <time dateTime={entry.createdAt}>
                  {time.format(new Date(entry.createdAt))}
                </time>
              </p>
              {entry.changes.length > 0 && (
                <ul>
                  {entry.changes.map((change) => (
                    <li key={change.field}>
                      <span>{change.field}</span>
                      <s>{change.from ?? "Empty"}</s>
                      <span aria-hidden="true">→</span>
                      <span className="sr-only">to</span>
                      <b>{change.to ?? "Empty"}</b>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
