import { z } from "zod";
import { recordId } from "./id-contract";
import { approvalPolicySchema } from "./approval-contract";

/**
 * CRM Deals and pipelines (docs/specs/deals-pipelines.md). A pipeline is a
 * standalone Deal board with stages in three categories; Deals on it carry a
 * stage, value, currency and one optional customer in their DealProfile.
 */
export const stageCategories = ["OPEN", "WON", "LOST"] as const;
export type StageCategory = (typeof stageCategories)[number];
export const categoryLabels: Record<StageCategory, string> = {
  OPEN: "Open",
  WON: "Won",
  LOST: "Lost",
};
/** New pipelines start with these; New is the default stage. */
export const defaultStages: {
  key: string;
  name: string;
  category: StageCategory;
}[] = [
  { key: "new", name: "New", category: "OPEN" },
  { key: "qualified", name: "Qualified", category: "OPEN" },
  { key: "proposal", name: "Proposal", category: "OPEN" },
  { key: "negotiation", name: "Negotiation", category: "OPEN" },
  { key: "won", name: "Won", category: "WON" },
  { key: "lost", name: "Lost", category: "LOST" },
];
export const MAX_STAGES = 30;

/** Deal fields in record create/update changes, and their board columns. */
export const dealFields = {
  stageId: { column: "deal_stage", label: "Stage" },
  amount: { column: "deal_amount", label: "Amount" },
  currency: { column: "deal_currency", label: "Currency" },
  customerCompanyId: { column: "deal_customer", label: "Customer" },
  customerContactId: { column: "deal_customer", label: "Customer" },
} as const;
export type DealKey = keyof typeof dealFields;
export const dealKeys = Object.keys(dealFields) as DealKey[];
export const dealColumnKeys = [
  ...new Set(Object.values(dealFields).map((field) => field.column)),
];

/** Up to 15 whole digits and 4 decimals, kept as text so nothing rounds. */
export const dealAmount = z
  .union([z.number(), z.string()])
  .nullable()
  .transform((value, context) => {
    if (value === null || value === "") return null;
    const text = String(value).trim().replace(/,/g, "");
    if (!/^\d{1,15}(\.\d{1,4})?$/.test(text)) {
      context.addIssue({
        code: "custom",
        message: "Enter an amount of 0 or more, with up to 4 decimals.",
      });
      return z.NEVER;
    }
    // Canonical form: no leading zeros, no trailing decimal zeros.
    const [whole, fraction = ""] = text.split(".");
    const trimmed = fraction.replace(/0+$/, "");
    return `${BigInt(whole!).toString()}${trimmed ? `.${trimmed}` : ""}`;
  });
export const dealCurrency = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, "Use a three-letter currency code, like PHP.")
  .nullable();
export const dealSchemas = {
  stageId: recordId,
  amount: dealAmount,
  currency: dealCurrency,
  customerCompanyId: recordId.nullable(),
  customerContactId: recordId.nullable(),
  /** Why a Won Deal became Lost, or the reverse. Only kept in its history. */
  stageReason: z.string().trim().min(1).max(500),
} satisfies Record<DealKey | "stageReason", z.ZodType>;
export type DealValues = {
  stageId: string;
  amount: string | null;
  currency: string | null;
  customerCompanyId: string | null;
  customerContactId: string | null;
};

// ---------- Pipeline configuration ----------

const stageName = z.string().trim().min(1).max(40);
const versioned = {
  boardId: recordId,
  /** The pipeline version the change was made against. */
  version: z.number().int().positive(),
};
export const pipelineCreateSchema = z
  .object({
    workspaceId: recordId,
    name: z.string().trim().min(1).max(100),
  })
  .strict();
/**
 * Which stage moves wait for approval while a pipeline's approvals are on:
 * CLOSING covers moves into, out of and between Won and Lost; ALL covers
 * every move.
 */
export const stageApprovalRules = ["CLOSING", "ALL"] as const;
export type StageApprovalRule = (typeof stageApprovalRules)[number];
export const stageNeedsApproval = (
  rule: StageApprovalRule,
  from: StageCategory,
  to: StageCategory,
) => rule === "ALL" || from !== "OPEN" || to !== "OPEN";
/** Stage requests nobody decides expire after this many days. */
export const STAGE_REQUEST_DAYS = 30;

export const stageCommandSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("add"),
      ...versioned,
      name: stageName,
      category: z.enum(stageCategories),
    })
    .strict(),
  z
    .object({
      action: z.literal("update"),
      ...versioned,
      stageId: recordId,
      name: stageName.optional(),
      category: z.enum(stageCategories).optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("move"),
      ...versioned,
      stageId: recordId,
      /** Its new place, from 0. */
      position: z.number().int().min(0).max(MAX_STAGES),
    })
    .strict(),
  z
    .object({ action: z.literal("remove"), ...versioned, stageId: recordId })
    .strict(),
  z
    .object({ action: z.literal("default"), ...versioned, stageId: recordId })
    .strict(),
  z
    .object({
      action: z.literal("approvals"),
      ...versioned,
      rule: z.enum(stageApprovalRules),
    })
    .strict(),
]);
export type StageCommand = z.infer<typeof stageCommandSchema>;

export const pipelineStageSchema = z.object({
  id: recordId,
  key: z.string(),
  name: z.string(),
  category: z.enum(stageCategories),
  position: z.number().int(),
  /** Live (not archived) Deals in this stage, across the whole pipeline. */
  count: z.number().int().nonnegative(),
  /** Their total value per currency, as decimal text. */
  totals: z.record(z.string(), z.string()),
});
export type PipelineStageView = z.infer<typeof pipelineStageSchema>;
export const pipelineSummarySchema = z.object({
  boardId: recordId,
  name: z.string(),
  version: z.number().int().positive(),
  defaultStageId: recordId,
  archived: z.boolean(),
  canManage: z.boolean(),
  /** The board's approvals are on. */
  approvals: z.boolean(),
  /** Which stage moves need approval while they are. */
  stageApproval: z.enum(stageApprovalRules),
  /** Who would review the viewer's stage request, if anyone can. */
  approverName: z.string().nullable(),
  /** The approval settings, for the pipeline's managers. */
  approvalSettings: approvalPolicySchema
    .extend({
      fields: z.array(
        z.object({ id: recordId, key: z.string(), name: z.string() }),
      ),
      people: z.array(z.object({ id: z.string(), name: z.string() })),
    })
    .nullable(),
  stages: z.array(pipelineStageSchema),
});
export type PipelineSummary = z.infer<typeof pipelineSummarySchema>;
export const pipelineListSchema = z.object({
  workspaceId: recordId,
  canCreate: z.boolean(),
  currency: z.string(),
  pipelines: z.array(
    pipelineSummarySchema
      .pick({
        boardId: true,
        name: true,
        archived: true,
      })
      .extend({
        openCount: z.number().int().nonnegative(),
        openTotals: z.record(z.string(), z.string()),
      }),
  ),
});
export type PipelineList = z.infer<typeof pipelineListSchema>;
/** Records stopping a stage from being removed or recategorized. */
export const stageBlockersSchema = z.object({
  total: z.number().int().nonnegative(),
  deals: z.array(
    z.object({
      id: recordId,
      name: z.string(),
      state: z.enum(["LIVE", "ARCHIVED", "TRASH"]),
    }),
  ),
  /** Waiting stage requests from or to the stage. */
  requests: z
    .array(
      z.object({
        dealId: recordId,
        dealName: z.string(),
        to: z.string(),
        authorName: z.string(),
      }),
    )
    .default([]),
});

/**
 * A deal's waiting stage request. People who can see requests (the
 * requester, the pipeline's managers and approvers, administrators) get the
 * details; everyone else only learns that one is waiting.
 */
export const stageRequestSchema = z
  .discriminatedUnion("visible", [
    z.object({
      visible: z.literal(true),
      id: recordId,
      fromStageId: recordId,
      toStageId: recordId,
      authorId: z.string(),
      authorName: z.string(),
      reviewerName: z.string().nullable(),
      note: z.string().nullable(),
      createdAt: z.string(),
      expiresAt: z.string(),
      canDecide: z.boolean(),
      canWithdraw: z.boolean(),
      canCancel: z.boolean(),
    }),
    z.object({ visible: z.literal(false) }),
  ])
  .nullable();
export type StageRequestView = z.infer<typeof stageRequestSchema>;
/** The viewer's latest stage request on a deal that closed unapplied. */
export const closedStageRequestSchema = z
  .object({
    id: recordId,
    toStageId: recordId,
    toStageName: z.string(),
    status: z.enum([
      "REJECTED",
      "STALE",
      "CANCELLED",
      "INVALIDATED",
      "EXPIRED",
    ]),
    reason: z.string().nullable(),
    decidedAt: z.string().nullable(),
  })
  .nullable();

/** The history kind a stage move records. */
export function stageTransition(
  from: StageCategory | null,
  to: StageCategory,
): "CREATED" | "MOVED" | "WON" | "LOST" | "REOPENED" {
  if (from === null) return "CREATED";
  if (from === to) return "MOVED";
  if (to === "OPEN") return "REOPENED";
  return to;
}
/** Moving straight between Won and Lost needs a confirmed reason. */
export const needsStageReason = (
  from: StageCategory | null,
  to: StageCategory,
) => (from === "WON" && to === "LOST") || (from === "LOST" && to === "WON");
