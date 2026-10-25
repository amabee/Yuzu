"use client";
import { useEffect, useState } from "react";
import { Link2, Lock, Plus, Star, Trash2, X } from "lucide-react";
import type { CrmLink, CrmLinks } from "@/lib/crm-contract";
import { useUiStore } from "@/components/providers";
import {
  saveError,
  useCrmLinkCommand,
  useCrmLinks,
  useCrmPicker,
  type CrmScope,
  type CrmType,
  type LinkCommand,
} from "./use-crm";
import { Initials } from "./crm-parts";

type Visible = Extract<CrmLink, { visible: true }>;

/**
 * A contact's companies, or a company's people. The contact owns each link,
 * so changes need edit access to the contact; a company shows its people
 * and can link new ones the viewer may edit. Opening a linked record stacks
 * its card on top of this one.
 */
export function CrmLinksPane({
  scope,
  recordId,
  side,
  archived,
  syncInterval,
  onNotice,
}: {
  scope: CrmScope;
  recordId: string;
  side: CrmType;
  archived: boolean;
  syncInterval: number;
  onNotice: (message: string, kind: "success" | "error") => void;
}) {
  const [page, setPage] = useState(1);
  const query = useCrmLinks(scope, recordId, page, syncInterval);
  const command = useCrmLinkCommand(scope);
  const openRecord = useUiStore((state) => state.openCrmRecord);
  const [picking, setPicking] = useState(false);
  const data = query.data;
  const title = side === "CONTACT" ? "Companies" : "People";
  const run = (next: LinkCommand, success: string) =>
    command.mutate(next, {
      onSuccess: (result) =>
        onNotice(
          result.outcome === "ALREADY_LINKED"
            ? "Already linked. The existing link is unchanged."
            : success,
          "success",
        ),
      onError: (error) => onNotice(saveError(error), "error"),
    });
  const links = data?.links ?? [];
  const current = links.filter((link) => link.status === "CURRENT");
  const former = links.filter((link) => link.status === "FORMER");
  return (
    <section className="crm-pane crm-links" aria-label={title}>
      <div className="crm-pane-head">
        <h3>{title}</h3>
        <span className="crm-count">{data?.total ?? ""}</span>
        <span className="crm-links-tools">
          {data?.canLink && !archived && (
            <button
              type="button"
              className="crm-button"
              data-size="sm"
              aria-expanded={picking}
              onClick={() => setPicking((value) => !value)}
            >
              <Plus size={14} aria-hidden="true" />
              {side === "CONTACT" ? "Link company" : "Link person"}
            </button>
          )}
        </span>
      </div>
      {data?.blocked && (
        <p className="crm-notice" role="status">
          <Lock size={14} aria-hidden="true" />
          <span>{data.blocked}</span>
        </p>
      )}
      {picking && data && (
        <LinkPicker
          scope={scope}
          side={side}
          linked={links.flatMap((link) =>
            link.visible ? [link.record.id] : [],
          )}
          pending={command.isPending}
          onCancel={() => setPicking(false)}
          onPick={(otherId, role) => {
            run(
              {
                action: "link",
                body:
                  side === "CONTACT"
                    ? { contactId: recordId, companyId: otherId, role }
                    : { contactId: otherId, companyId: recordId, role },
              },
              "Linked",
            );
            setPicking(false);
          }}
        />
      )}
      {query.isError && !data ? (
        <p className="crm-links-empty" role="alert">
          {saveError(query.error)}
        </p>
      ) : !data ? (
        <p className="crm-links-empty" aria-busy="true">
          Loading…
        </p>
      ) : !links.length ? (
        <p className="crm-links-empty">
          {side === "CONTACT"
            ? "No companies. This contact is an individual; link a company if they work for one."
            : "No people yet. Link people who work here."}
        </p>
      ) : (
        <>
          {[
            ["Current", current],
            ["Former", former],
          ].map(([label, group]) =>
            (group as CrmLink[]).length ? (
              <LinkGroup
                key={label as string}
                label={label as string}
                links={group as CrmLink[]}
                side={side}
                data={data}
                recordId={recordId}
                pending={command.isPending}
                onRun={run}
                onOpen={(id) => openRecord(id, "stack")}
              />
            ) : null,
          )}
          {data.pageCount > 1 && (
            <div className="crm-links-pager">
              <button
                type="button"
                className="crm-button"
                data-size="sm"
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
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
                disabled={page >= data.pageCount}
                onClick={() => setPage(page + 1)}
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
      {side === "COMPANY" && links.length > 0 && (
        <p className="crm-links-note">
          Links belong to each contact, so changing one needs edit access to
          that contact.
        </p>
      )}
    </section>
  );
}

function LinkGroup({
  label,
  links,
  side,
  data,
  recordId,
  pending,
  onRun,
  onOpen,
}: {
  label: string;
  links: CrmLink[];
  side: CrmType;
  data: CrmLinks;
  recordId: string;
  pending: boolean;
  onRun: (command: LinkCommand, success: string) => void;
  onOpen: (id: string) => void;
}) {
  return (
    <div className="crm-link-group" data-status={label}>
      <h4>
        <i aria-hidden="true" />
        {label} <small>{links.length}</small>
      </h4>
      <ul>
        {links.map((link) =>
          link.visible ? (
            <LinkRow
              key={link.id}
              link={link}
              side={side}
              data={data}
              recordId={recordId}
              pending={pending}
              onRun={onRun}
              onOpen={onOpen}
            />
          ) : (
            <li key={link.key} className="crm-link-row" data-private="">
              <span className="crm-mono" aria-hidden="true">
                <Lock size={12} />
              </span>
              <span className="crm-link-name">
                <b>Private company</b>
                <small>You don&apos;t have access to this company.</small>
              </span>
            </li>
          ),
        )}
      </ul>
    </div>
  );
}

function LinkRow({
  link,
  side,
  data,
  recordId,
  pending,
  onRun,
  onOpen,
}: {
  link: Visible;
  side: CrmType;
  data: CrmLinks;
  recordId: string;
  pending: boolean;
  onRun: (command: LinkCommand, success: string) => void;
  onOpen: (id: string) => void;
}) {
  const [role, setRole] = useState(link.role ?? "");
  const [seen, setSeen] = useState(link.role);
  // Changing the primary link asks once more: it clears the primary too.
  const [confirm, setConfirm] = useState<"former" | "remove" | null>(null);
  if (link.role !== seen) {
    setSeen(link.role);
    setRole(link.role ?? "");
  }
  const editable = link.canEdit && !pending;
  const primaryToken =
    data.primaryRevision === null
      ? {}
      : { primaryRevision: data.primaryRevision };
  const saveRole = () => {
    const next = role.trim() || null;
    if (next === (link.role ?? null)) return;
    if (next && next.length > 120) return setRole(link.role ?? "");
    onRun(
      {
        action: "update-link",
        body: {
          linkId: link.id,
          revision: link.revision,
          changes: { role: next },
        },
      },
      "Role saved",
    );
  };
  const setStatus = (status: "CURRENT" | "FORMER", clearPrimary = false) =>
    onRun(
      {
        action: "update-link",
        body: {
          linkId: link.id,
          revision: link.revision,
          changes: { status },
          ...(clearPrimary ? { clearPrimary, ...primaryToken } : {}),
        },
      },
      status === "FORMER" ? "Marked as former" : "Marked as current",
    );
  const remove = (clearPrimary = false) =>
    onRun(
      {
        action: "remove-link",
        body: {
          linkId: link.id,
          revision: link.revision,
          ...(clearPrimary ? { clearPrimary, ...primaryToken } : {}),
        },
      },
      "Link removed",
    );
  const noun = side === "CONTACT" ? "company" : "contact";
  return (
    <li className="crm-link-row" data-primary={link.isPrimary || undefined}>
      <Initials name={link.record.name} person={side === "COMPANY"} />
      <span className="crm-link-name">
        <button
          type="button"
          className="crm-link-open"
          onClick={() => onOpen(link.record.id)}
          aria-label={`Open ${link.record.name}`}
        >
          {link.record.name}
        </button>
        <small>
          {link.record.detail ??
            (side === "CONTACT" ? "No domain" : "No email")}
          {link.record.archived ? " · Archived" : ""}
        </small>
      </span>
      <label className="crm-link-role">
        <span className="sr-only">Role at {link.record.name}</span>
        <input
          value={role}
          placeholder={editable ? "Add role" : "No role"}
          maxLength={120}
          readOnly={!editable}
          onChange={(event) => setRole(event.target.value)}
          onBlur={saveRole}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
            if (event.key === "Escape") {
              setRole(link.role ?? "");
              event.currentTarget.blur();
            }
          }}
          data-crm-field=""
          data-dirty={role !== (link.role ?? "") || undefined}
        />
      </label>
      <label className="crm-link-status">
        <span className="sr-only">Status at {link.record.name}</span>
        <select
          value={link.status}
          disabled={!editable}
          onChange={(event) => {
            const status = event.target.value as "CURRENT" | "FORMER";
            if (status === "FORMER" && link.isPrimary) setConfirm("former");
            else setStatus(status);
          }}
        >
          <option value="CURRENT">Current</option>
          <option value="FORMER">Former</option>
        </select>
      </label>
      {side === "CONTACT" ? (
        <button
          type="button"
          className="crm-primary-toggle"
          aria-pressed={link.isPrimary}
          disabled={!editable || link.status !== "CURRENT"}
          title={
            link.status !== "CURRENT"
              ? "Only a current company can be primary"
              : link.isPrimary
                ? "Clear as primary company"
                : "Make primary company"
          }
          onClick={() =>
            onRun(
              {
                action: "primary",
                body: {
                  contactId: recordId,
                  linkId: link.isPrimary ? null : link.id,
                  ...(link.isPrimary ? {} : { linkRevision: link.revision }),
                  primaryRevision: data.primaryRevision ?? 0,
                },
              },
              link.isPrimary
                ? "Primary company cleared"
                : "Primary company set",
            )
          }
        >
          <Star size={14} aria-hidden="true" />
          {link.isPrimary ? "Primary" : "Make primary"}
        </button>
      ) : (
        link.isPrimary && (
          <span className="crm-primary-pill">Primary company</span>
        )
      )}
      {editable && (
        <button
          type="button"
          className="crm-icon-button"
          aria-label={`Remove link to ${link.record.name}`}
          onClick={() => (link.isPrimary ? setConfirm("remove") : remove())}
        >
          <Trash2 size={14} aria-hidden="true" />
        </button>
      )}
      {confirm && (
        <div className="crm-link-confirm" role="alert">
          <span>
            {side === "CONTACT"
              ? `This is the contact's primary ${noun}.`
              : "This is the contact's primary company."}{" "}
            {confirm === "former"
              ? "Marking it former also clears it as primary."
              : "Removing the link also clears it as primary."}
          </span>
          <button
            type="button"
            className="crm-button"
            data-size="sm"
            onClick={() => {
              if (confirm === "former") setStatus("FORMER", true);
              else remove(true);
              setConfirm(null);
            }}
          >
            {confirm === "former" ? "Mark former" : "Remove link"}
          </button>
          <button
            type="button"
            className="crm-icon-button"
            aria-label="Cancel"
            onClick={() => setConfirm(null)}
          >
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      )}
    </li>
  );
}

/** Finds a company (or person) to link, with an optional role. */
function LinkPicker({
  scope,
  side,
  linked,
  pending,
  onPick,
  onCancel,
}: {
  scope: CrmScope;
  side: CrmType;
  linked: string[];
  pending: boolean;
  onPick: (id: string, role: string | null) => void;
  onCancel: () => void;
}) {
  const other: CrmType = side === "CONTACT" ? "COMPANY" : "CONTACT";
  const [q, setQ] = useState("");
  const [settled, setSettled] = useState("");
  const [role, setRole] = useState("");
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(q.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [q]);
  const results = useCrmPicker(scope, other, settled, true);
  const options = (results.data ?? [])
    .filter((record) => !linked.includes(record.id))
    .slice(0, 8);
  const label = other === "COMPANY" ? "company" : "person";
  return (
    <div className="crm-picker" role="group" aria-label={`Link a ${label}`}>
      <div className="crm-picker-inputs">
        <label className="crm-search">
          <Link2 size={14} aria-hidden="true" />
          <input
            autoFocus
            type="search"
            aria-label={`Find a ${label}`}
            placeholder={`Find a ${label} by name${other === "COMPANY" ? ", domain" : ""} or email`}
            value={q}
            onChange={(event) => setQ(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape" && !q) onCancel();
            }}
          />
        </label>
        <input
          className="crm-picker-role"
          aria-label="Role (optional)"
          placeholder="Role (optional)"
          maxLength={120}
          value={role}
          onChange={(event) => setRole(event.target.value)}
        />
        <button
          type="button"
          className="crm-icon-button"
          aria-label="Close"
          onClick={onCancel}
        >
          <X size={14} aria-hidden="true" />
        </button>
      </div>
      <ul className="crm-picker-results" aria-live="polite">
        {options.map((record) => (
          <li key={record.id}>
            <button
              type="button"
              disabled={pending || Boolean(record.archivedAt)}
              onClick={() => onPick(record.id, role.trim() || null)}
            >
              <Initials name={record.name} person={other === "CONTACT"} />
              <span className="crm-link-name">
                <b>{record.name}</b>
                <small>
                  {(other === "COMPANY"
                    ? (record.profile.domain ?? record.profile.email)
                    : record.profile.email) ?? ""}
                </small>
              </span>
              <span className="crm-picker-add">Link</span>
            </button>
          </li>
        ))}
        {results.data && !options.length && (
          <li className="crm-links-empty">
            {settled
              ? `No ${label === "company" ? "companies" : "people"} match “${settled}”.`
              : `Every ${label} here is already linked.`}
          </li>
        )}
      </ul>
    </div>
  );
}
