import { z } from "zod";

/**
 * Record types: what a board's records are. The server enforces each type's
 * rules; the client reads the same definitions to show the right fields.
 * See docs/specs/record-foundation.md and docs/specs/record-contract.md.
 */
export const recordTypes = [
  "TASK",
  "DEAL",
  "CUSTOM",
  "COMPANY",
  "CONTACT",
] as const;
export type RecordType = (typeof recordTypes)[number];
/** Types someone may pick for a new Work board. */
export const creatableRecordTypes = ["TASK", "DEAL", "CUSTOM"] as const;
/** CRM collections: one per workspace each, shown only in the CRM module. */
export const crmRecordTypes = ["COMPANY", "CONTACT"] as const;
export type CrmRecordType = (typeof crmRecordTypes)[number];
export const isCrmRecordType = (type: unknown): type is CrmRecordType =>
  crmRecordTypes.includes(type as CrmRecordType);
/** Prisma filter for boards that belong to the Work module: not CRM
 *  collections, and not CRM pipelines (Deal boards with a pipeline). */
export const workBoardWhere = {
  recordType: { notIn: [...crmRecordTypes] },
  pipeline: { is: null },
};

export const builtinKeys = [
  "status",
  "priority",
  "assignees",
  "startDate",
  "dueDate",
  "description",
  "checklist",
] as const;
export type BuiltinKey = (typeof builtinKeys)[number];

/** The board column behind each built-in (checklist has none). */
export const builtinColumnKey: Record<BuiltinKey, string | null> = {
  status: "status",
  priority: "priority",
  assignees: "assignees",
  startDate: "start_date",
  dueDate: "due_date",
  description: "description",
  checklist: null,
};
export const builtinLabels: Record<BuiltinKey, string> = {
  status: "Status",
  priority: "Priority",
  assignees: "Assignees",
  startDate: "Start date",
  dueDate: "Due date",
  description: "Description",
  checklist: "Checklist",
};

const label = z.string().trim().min(1).max(40);
const builtin = z.object({ on: z.boolean(), label: label.optional() });
export const recordConfigSchema = z.object({
  singular: label,
  plural: label,
  builtins: z.object(
    Object.fromEntries(builtinKeys.map((key) => [key, builtin])) as Record<
      BuiltinKey,
      typeof builtin
    >,
  ),
});
export type RecordConfig = z.infer<typeof recordConfigSchema>;
/** What a board stores: any part may be missing; the type fills the rest. */
const savedConfigSchema = z.object({
  singular: label.optional(),
  plural: label.optional(),
  builtins: z.partialRecord(z.enum(builtinKeys), builtin.partial()).optional(),
});

type Definition = {
  label: string;
  description: string;
  defaults: RecordConfig;
  /** Built-ins this type keeps as they are; people can't switch them. */
  locked: Partial<Record<BuiltinKey, true>>;
  /** Whether people may rename the records. */
  renamable: boolean;
  /** At most this many assignees (the Deal's single owner). */
  maxAssignees?: number;
};

const on = (label?: string) => ({ on: true, ...(label ? { label } : {}) });
const off = { on: false };
// Customer records have an owner and notes, never task status or dates.
const crmBuiltins: RecordConfig["builtins"] = {
  status: off,
  priority: off,
  assignees: on("Owner"),
  startDate: off,
  dueDate: off,
  description: on("Notes"),
  checklist: off,
};
const crmLocked = Object.fromEntries(
  builtinKeys.map((key) => [key, true]),
) as Record<BuiltinKey, true>;
const allOn = Object.fromEntries(
  builtinKeys.map((key) => [key, on()]),
) as RecordConfig["builtins"];

export const recordDefinitions: Record<RecordType, Definition> = {
  TASK: {
    label: "Tasks",
    description: "Work with status, priority, assignees and dates",
    defaults: { singular: "Task", plural: "Tasks", builtins: allOn },
    locked: {},
    renamable: false,
    // Task boards keep every switch, but they all start on.
  },
  DEAL: {
    label: "Deals",
    description:
      "Sales pipeline: stage, owner, close date, amount, probability",
    defaults: {
      singular: "Deal",
      plural: "Deals",
      builtins: {
        status: on("Stage"),
        priority: off,
        assignees: on("Owner"),
        startDate: off,
        dueDate: on("Close date"),
        description: on(),
        checklist: off,
      },
    },
    locked: { status: true, assignees: true, dueDate: true },
    renamable: false,
    maxAssignees: 1,
  },
  CUSTOM: {
    label: "Something else",
    description: "Name your records and pick their fields",
    defaults: { singular: "Item", plural: "Items", builtins: allOn },
    locked: {},
    renamable: true,
  },
  COMPANY: {
    label: "Companies",
    description: "The businesses you work with",
    defaults: {
      singular: "Company",
      plural: "Companies",
      builtins: crmBuiltins,
    },
    locked: crmLocked,
    renamable: false,
    maxAssignees: 1,
  },
  CONTACT: {
    label: "Contacts",
    description: "The people you work with",
    defaults: {
      singular: "Contact",
      plural: "Contacts",
      builtins: crmBuiltins,
    },
    locked: crmLocked,
    renamable: false,
    maxAssignees: 1,
  },
};

export const dealStages = [
  { id: "lead", label: "Lead", icon: "circle" },
  { id: "qualified", label: "Qualified", icon: "circle-dot" },
  { id: "proposal", label: "Proposal", icon: "clock" },
  { id: "negotiation", label: "Negotiation", icon: "rotate-ccw" },
  { id: "won", label: "Won", icon: "check-circle" },
  { id: "lost", label: "Lost", icon: "ban" },
] as const;

/** Board details → Records on this board. `preview` reports what turning
 *  fields off would affect, without saving. */
export const recordSettingsSchema = z
  .object({
    boardId: z.string().uuid(),
    record: z
      .object({
        singular: label,
        plural: label,
        builtins: z.partialRecord(
          z.enum(builtinKeys),
          z.object({ on: z.boolean(), label: label.optional() }),
        ),
      })
      .partial(),
    preview: z.boolean().default(false),
  })
  .strict();

/** What a new board may choose: its type, and for custom boards the rest. */
export const recordChoiceSchema = z.object({
  recordType: z.enum(creatableRecordTypes).default("TASK"),
  record: z
    .object({
      singular: label,
      plural: label,
      builtins: z.partialRecord(
        z.enum(builtinKeys),
        z.object({ on: z.boolean(), label: label.optional() }),
      ),
    })
    .partial()
    .optional(),
});
/** Fields a Deal board always has; they can't be removed or retyped. */
export const dealSystemFields = [
  {
    key: "amount",
    name: "Amount",
    config: { format: "currency", decimals: 2, min: 0, system: true },
  },
  {
    key: "probability",
    name: "Probability",
    config: { format: "percent", decimals: 0, min: 0, max: 100, system: true },
  },
] as const;

export const asRecordType = (value: unknown): RecordType =>
  recordTypes.includes(value as RecordType) ? (value as RecordType) : "TASK";

/**
 * A board's effective config: the type's defaults, the saved choices on top,
 * and the type's locks last. Invalid saved config falls back to defaults.
 */
export function resolveRecordConfig(
  type: RecordType,
  saved: unknown,
): RecordConfig {
  const definition = recordDefinitions[type];
  const parsed = savedConfigSchema.safeParse(saved ?? {});
  const config = parsed.success ? parsed.data : {};
  const builtins = { ...definition.defaults.builtins };
  for (const key of builtinKeys) {
    const choice = config.builtins?.[key];
    if (!choice) continue;
    builtins[key] = {
      on: definition.locked[key]
        ? builtins[key].on
        : (choice.on ?? builtins[key].on),
      ...((choice.label ?? builtins[key].label)
        ? { label: choice.label ?? builtins[key].label }
        : {}),
    };
  }
  return {
    singular: definition.renamable
      ? (config.singular ?? definition.defaults.singular)
      : definition.defaults.singular,
    plural: definition.renamable
      ? (config.plural ?? definition.defaults.plural)
      : definition.defaults.plural,
    builtins,
  };
}

export const builtinOn = (config: RecordConfig, key: BuiltinKey) =>
  config.builtins[key].on;
export const builtinName = (config: RecordConfig, key: BuiltinKey) =>
  config.builtins[key].label ?? builtinLabels[key];

/** The board's built-in for a column key, if it is one. */
export const builtinForColumn = (columnKey: string) =>
  builtinKeys.find((key) => builtinColumnKey[key] === columnKey);

/** "Deal" → "deal", for use mid-sentence. */
export const lower = (word: string) =>
  word.length > 1 && word[1] === word[1]!.toUpperCase()
    ? word // keep acronyms like "RFP"
    : word.charAt(0).toLowerCase() + word.slice(1);
/** "3 deals", "1 deal". */
export const countOf = (config: RecordConfig, n: number) =>
  `${n.toLocaleString()} ${lower(n === 1 ? config.singular : config.plural)}`;
/** "a deal", "an item". */
export const aRecord = (config: RecordConfig) =>
  `${/^[aeiou]/i.test(config.singular) ? "an" : "a"} ${lower(config.singular)}`;

// ---------- Number formats ----------

export const numberFormats = ["plain", "currency", "percent"] as const;
export type NumberFormat = (typeof numberFormats)[number];
export const numberConfigSchema = z.object({
  format: z.enum(numberFormats).default("plain"),
  decimals: z.number().int().min(0).max(4).optional(),
  min: z.number().finite().optional(),
  max: z.number().finite().optional(),
  system: z.boolean().optional(),
});
export type NumberConfig = z.infer<typeof numberConfigSchema>;
export const numberConfig = (config: unknown): NumberConfig => {
  const parsed = numberConfigSchema.safeParse(config ?? {});
  return parsed.success ? parsed.data : { format: "plain" };
};
export const currencyCode = z
  .string()
  .regex(/^[A-Z]{3}$/, "Use a three-letter currency code, like PHP.");

/** Shows a number the way its field is set up, e.g. ₱16,400.00 or 60%. */
export function formatNumber(
  value: number,
  config: unknown,
  currency = "PHP",
  locale?: string,
) {
  const { format, decimals } = numberConfig(config);
  try {
    if (format === "currency")
      return new Intl.NumberFormat(locale, {
        style: "currency",
        currency,
        minimumFractionDigits: decimals ?? 2,
        maximumFractionDigits: decimals ?? 2,
      }).format(value);
    if (format === "percent")
      return `${new Intl.NumberFormat(locale, {
        maximumFractionDigits: decimals ?? 0,
        minimumFractionDigits: decimals ?? 0,
      }).format(value)}%`;
    return new Intl.NumberFormat(locale, {
      maximumFractionDigits: decimals ?? 4,
      ...(decimals !== undefined ? { minimumFractionDigits: decimals } : {}),
    }).format(value);
  } catch {
    return String(value);
  }
}
