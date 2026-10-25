"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { CrmDirectory, CrmMatches } from "@/lib/crm-contract";
import { useCrmMatches, type CrmScope } from "./use-crm";

const initials = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => Array.from(part)[0] ?? "")
    .join("")
    .toUpperCase();

/** A record's initials: rounded squares for companies, circles for people. */
export function Initials({
  name,
  person,
  size = "sm",
}: {
  name: string;
  person: boolean;
  size?: "sm" | "lg";
}) {
  return (
    <span
      className="crm-mono"
      data-person={person || undefined}
      data-size={size}
      aria-hidden="true"
    >
      {initials(name) || "?"}
    </span>
  );
}

export function OwnerName({
  people,
  id,
}: {
  people: CrmDirectory["people"];
  id: string;
}) {
  const person = people.find((item) => item.id === id);
  const name = person?.name ?? "Former teammate";
  return (
    <span className="crm-owner">
      <span className="crm-avatar" aria-hidden="true">
        {initials(name)}
      </span>
      <span>
        {name}
        {person?.deactivated ? " (deactivated)" : ""}
      </span>
    </span>
  );
}

const reasons: Record<CrmMatches[number]["reason"], string> = {
  EMAIL: "Same email",
  DOMAIN: "Same domain",
  NAME: "Similar name",
};

/** Debounces typing before asking the server for look-alikes. */
function useSettled(value: string, delay = 300) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return settled;
}

/**
 * The grid's last row: type a name and press Enter to add a record, or Tab
 * to add it and carry on in its next cell. Records that look the same are
 * suggested first; a second Enter (or "Add anyway") adds it regardless.
 * Nothing is ever merged.
 */
export function AddRow({
  scope,
  label,
  disabled,
  pending,
  onCreate,
  onOpen,
  slot,
}: {
  /** Where suggestions show: below the grid, outside its scroll area. */
  slot: HTMLElement | null;
  scope: CrmScope;
  label: string;
  disabled: string | null;
  pending: boolean;
  /** `next`: keep going in the new record's next cell. */
  onCreate: (name: string, next?: boolean) => Promise<boolean>;
  onOpen: (id: string) => void;
}) {
  const [name, setName] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  // The name being saved, so a quick second entry is neither blocked nor wiped.
  const [saving, setSaving] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const settled = useSettled(name);
  const matches = useCrmMatches(scope, { name: settled });
  const suggestions =
    settled.trim().length >= 3 && settled === name ? (matches.data ?? []) : [];
  const listId = `crm-matches-${scope.type}`;
  const submit = async (next: boolean) => {
    const submitted = name.trim();
    if (!submitted || submitted === saving) return;
    setSaving(submitted);
    const created = await onCreate(submitted, next);
    setSaving(null);
    if (!created) return;
    setName((current) => (current.trim() === submitted ? "" : current));
    setConfirmed(false);
    // With Tab, the grid moves on into the new record instead.
    if (!next) input.current?.focus();
  };
  const add = (next = false) => {
    if (suggestions.length && !confirmed) {
      setConfirmed(true);
      return;
    }
    void submit(next);
  };
  return (
    <div className="crm-add">
      <input
        ref={input}
        className="crm-add-input"
        aria-label={label}
        placeholder={disabled ?? `+ ${label}`}
        disabled={Boolean(disabled)}
        value={name}
        maxLength={200}
        autoComplete="off"
        aria-describedby={suggestions.length ? listId : undefined}
        onChange={(event) => {
          setName(event.target.value);
          setConfirmed(false);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            add();
          } else if (event.key === "Tab" && !event.shiftKey && name.trim()) {
            event.preventDefault();
            add(true);
          } else if (event.key === "Escape") {
            setName("");
            setConfirmed(false);
          }
        }}
      />
      {suggestions.length > 0 &&
        slot &&
        createPortal(
          <div
            className="crm-familiar"
            id={listId}
            role="region"
            aria-live="polite"
            aria-label="Similar records"
          >
            <header>
              <b>These look familiar</b>
              <span>
                Open one instead, or add a new record anyway. Yuzu never merges
                records on its own.
              </span>
            </header>
            <ul>
              {suggestions.map((match) => (
                <li key={match.id}>
                  <Initials
                    name={match.name}
                    person={scope.type === "CONTACT"}
                  />
                  <span className="crm-familiar-name">
                    <b>{match.name}</b>
                    {match.detail && <small>{match.detail}</small>}
                  </span>
                  <span className="crm-familiar-why">
                    {match.archived ? "Archived · " : ""}
                    {reasons[match.reason]}
                  </span>
                  <button type="button" onClick={() => onOpen(match.id)}>
                    Open
                  </button>
                </li>
              ))}
            </ul>
            <footer>
              <span>
                {confirmed
                  ? "Press Enter again to add it anyway."
                  : "Not the same? Press Enter twice to add it anyway."}
              </span>
              <button
                type="button"
                className="crm-button"
                data-size="sm"
                disabled={pending && saving === name.trim()}
                onClick={() => void submit(false)}
              >
                Add anyway
              </button>
            </footer>
          </div>,
          slot,
        )}
    </div>
  );
}
