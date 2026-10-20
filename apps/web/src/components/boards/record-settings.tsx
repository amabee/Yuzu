"use client";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { z } from "zod";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { apiRequest } from "@/lib/api-client";
import {
  builtinKeys,
  builtinName,
  recordDefinitions,
  recordTypes,
  resolveRecordConfig,
  type BuiltinKey,
  type RecordConfig,
  type RecordType,
} from "@/lib/record-types";
import { recordOf, type BoardState } from "@/lib/board-contract";
import { PauseButton } from "@/components/pause/pause-dialog";

export type RecordDraft = {
  singular?: string;
  plural?: string;
  builtins?: Partial<Record<BuiltinKey, { on: boolean; label?: string }>>;
};

/** Tasks, Deals or something else: what a new board holds. */
export function RecordTypePicker({
  value,
  onChange,
}: {
  value: RecordType;
  onChange: (type: RecordType) => void;
}) {
  return (
    <div
      className="record-types"
      role="radiogroup"
      aria-label="What this board holds"
    >
      {recordTypes.map((type) => (
        <button
          key={type}
          type="button"
          role="radio"
          aria-checked={value === type}
          onClick={() => onChange(type)}
        >
          <b>{recordDefinitions[type].label}</b>
          <small>{recordDefinitions[type].description}</small>
        </button>
      ))}
    </div>
  );
}

/** Names and built-in switches for a record type. Locked ones stay on. */
export function RecordFieldsEditor({
  type,
  value,
  onChange,
}: {
  type: RecordType;
  value: RecordDraft;
  onChange: (value: RecordDraft) => void;
}) {
  const definition = recordDefinitions[type];
  const config = resolveRecordConfig(type, value);
  return (
    <div className="record-fields">
      {definition.renamable && (
        <div className="record-names">
          <label className="task-field-label">
            One record is a
            <Input
              aria-label="One record is a"
              maxLength={40}
              value={value.singular ?? config.singular}
              onChange={(event) =>
                onChange({ ...value, singular: event.target.value })
              }
            />
          </label>
          <label className="task-field-label">
            Many are
            <Input
              aria-label="Many are"
              maxLength={40}
              value={value.plural ?? config.plural}
              onChange={(event) =>
                onChange({ ...value, plural: event.target.value })
              }
            />
          </label>
        </div>
      )}
      <ul className="record-switches">
        {builtinKeys.map((key) => {
          const locked = Boolean(definition.locked[key]);
          return (
            <li key={key}>
              <Switch
                aria-label={builtinName(config, key)}
                checked={config.builtins[key].on}
                disabled={locked}
                onCheckedChange={(on) =>
                  onChange({
                    ...value,
                    builtins: {
                      ...value.builtins,
                      [key]: { ...config.builtins[key], on },
                    },
                  })
                }
              />
              <span>{builtinName(config, key)}</span>
              {locked && (
                <small>Always on for {config.plural.toLowerCase()}</small>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const affectedSchema = z.object({
  affected: z.object({
    rules: z.array(z.string()),
    views: z.array(z.string()),
  }),
});

/** Board details → Records on this board. */
export function BoardRecordSettings({
  state,
  pending,
  onAction,
}: {
  state: BoardState;
  pending: boolean;
  /** Saves through the board's own mutation (toast, refresh, realtime). */
  onAction: (action: string, input: unknown) => void;
}) {
  const record = recordOf(state);
  const initial: RecordDraft = {
    singular: record.singular,
    plural: record.plural,
    builtins: record.builtins,
  };
  const [draft, setDraft] = useState<RecordDraft>(initial);
  const [warning, setWarning] = useState<{
    rules: string[];
    views: string[];
  } | null>(null);
  const save = useMutation({
    mutationFn: async (confirmed: boolean) => {
      if (!confirmed) {
        // Ask first what turning fields off would affect.
        const { affected } = affectedSchema.parse(
          (
            await apiRequest("/api/v1/boards/record-settings", {
              method: "POST",
              json: { boardId: state.boardId, record: draft, preview: true },
            })
          ).data,
        );
        if (affected.rules.length || affected.views.length) {
          setWarning(affected);
          return;
        }
      }
      setWarning(null);
      onAction("record-settings", { boardId: state.boardId, record: draft });
    },
  });
  const changed =
    JSON.stringify(resolveRecordConfig(record.type, draft)) !==
    JSON.stringify(resolveRecordConfig(record.type, initial as RecordConfig));
  return (
    <section className="record-settings" aria-labelledby="record-settings">
      <h3 id="record-settings" className="font-semibold">
        Records on this board
      </h3>
      <p className="text-sm text-muted-foreground">
        {record.type === "CUSTOM"
          ? "A custom board."
          : `A ${recordDefinitions[record.type].label.toLowerCase()} board.`}{" "}
        Turned-off fields are hidden everywhere; their values are kept.
      </p>
      <RecordFieldsEditor
        type={record.type}
        value={draft}
        onChange={setDraft}
      />
      {warning && (
        <p role="alert" className="record-warning">
          Turning these off affects{" "}
          {[
            warning.rules.length &&
              `${warning.rules.length === 1 ? "a rule" : `${warning.rules.length} rules`} (${warning.rules.join(", ")}), which will skip until it's back on`,
            warning.views.length &&
              `${warning.views.length === 1 ? "a saved view" : `${warning.views.length} saved views`} (${warning.views.join(", ")}), which will ignore it`,
          ]
            .filter(Boolean)
            .join(" and ")}
          .
        </p>
      )}
      {save.error && (
        <p role="alert" className="text-sm text-destructive">
          {save.error.message}
        </p>
      )}
      <div className="flex gap-2">
        <PauseButton
          tone="primary"
          disabled={!changed || save.isPending || pending}
          onClick={() => save.mutate(Boolean(warning))}
        >
          {warning ? "Turn off anyway" : "Save"}
        </PauseButton>
        {warning && (
          <PauseButton
            onClick={() => {
              setWarning(null);
              setDraft(initial);
            }}
          >
            Keep them on
          </PauseButton>
        )}
      </div>
    </section>
  );
}
