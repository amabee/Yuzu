"use client";
import { useState } from "react";

/** Fields shared by CRM record and deal cards. */
export function NameField({
  label,
  record,
  readOnly,
  onSave,
}: {
  label: string;
  record?: { name: string };
  readOnly: boolean;
  onSave: (name: string) => void;
}) {
  const [draft, setDraft] = useState(record?.name ?? "");
  const [error, setError] = useState<string | null>(null);
  // Follow saved changes, including other people's, while not typing.
  const [seen, setSeen] = useState(record?.name);
  if (record && record.name !== seen) {
    setSeen(record.name);
    setDraft(record.name);
  }
  const commit = () => {
    if (!record) return;
    const name = draft.trim();
    if (!name) {
      setError("A name is required.");
      return;
    }
    setError(null);
    if (name !== record.name) onSave(name);
  };
  return (
    <div className="crm-card-name-wrap">
      <input
        className="crm-card-name"
        aria-label={label}
        data-crm-field=""
        data-dirty={(record && draft !== record.name) || undefined}
        value={draft}
        maxLength={200}
        readOnly={readOnly}
        aria-invalid={Boolean(error)}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") {
            setDraft(record?.name ?? "");
            setError(null);
            event.currentTarget.blur();
          }
        }}
      />
      {error && (
        <span role="alert" className="crm-field-error">
          {error}
        </span>
      )}
    </div>
  );
}

/** A text box that keeps its draft while focused and saves valid changes. */
export function useDraft(value: string) {
  const [draft, setDraft] = useState(value);
  const [focused, setFocused] = useState(false);
  const [seen, setSeen] = useState(value);
  if (value !== seen) {
    setSeen(value);
    if (!focused) setDraft(value);
  }
  return { draft, setDraft, setFocused };
}
