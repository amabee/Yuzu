"use client";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { z } from "zod";
import { apiRequest } from "@/lib/api-client";
import { taskMutationResultSchema } from "@/lib/approval-contract";
import {
  pipelineListSchema,
  pipelineSummarySchema,
  stageCategories,
  type StageCommand,
} from "@/lib/deal-contract";
import { recordId } from "@/lib/id-contract";
import { crmKeys, type CrmScope } from "./use-crm";

/** Cards in the CRM stack: deals are kept as "deal:<id>". */
export const dealEntry = (id: string) => `deal:${id}`;
export const dealIdOf = (entry: string) =>
  entry.startsWith("deal:") ? entry.slice(5) : null;

const person = z.object({
  id: z.string(),
  name: z.string(),
  image: z.string().nullable().optional(),
  deactivated: z.boolean().optional(),
});
const customerSchema = z
  .discriminatedUnion("visible", [
    z.object({
      visible: z.literal(true),
      type: z.enum(["COMPANY", "CONTACT"]),
      id: recordId,
      name: z.string(),
      archived: z.boolean(),
    }),
    z.object({
      visible: z.literal(false),
      type: z.enum(["COMPANY", "CONTACT"]),
    }),
  ])
  .nullable();
export const dealSchema = z.object({
  id: recordId,
  name: z.string(),
  description: z.string(),
  ownerId: z.string().nullable(),
  expectedCloseDate: z.string().nullable(),
  stageId: recordId,
  amount: z.string().nullable(),
  currency: z.string().nullable(),
  customer: customerSchema,
  closedAt: z.string().nullable(),
  archivedAt: z.string().nullable(),
  createdAt: z.string(),
  revision: z.number().int().positive(),
  position: z.number(),
  canEdit: z.boolean(),
  commentCount: z.number().int().nonnegative(),
  attachmentCount: z.number().int().nonnegative(),
});
export type Deal = z.infer<typeof dealSchema>;
const lanesSchema = z.object({
  boardId: recordId,
  people: z.array(person),
  lanes: z.array(
    z.object({
      stageId: recordId,
      total: z.number().int().nonnegative(),
      deals: z.array(dealSchema),
    }),
  ),
});
export type DealLanes = z.infer<typeof lanesSchema>;
const listSchema = z.object({
  boardId: recordId,
  people: z.array(person),
  deals: z.array(dealSchema),
  page: z.number().int().positive(),
  pageCount: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
});
const category = z.enum(stageCategories);
const dealDetailSchema = z.object({
  boardId: recordId,
  deal: dealSchema,
  history: z.array(
    z.object({
      id: recordId,
      kind: z.enum(["CREATED", "MOVED", "WON", "LOST", "REOPENED"]),
      from: z.string().nullable(),
      fromCategory: category.nullable(),
      to: z.string(),
      toCategory: category,
      amount: z.string().nullable(),
      currency: z.string().nullable(),
      reason: z.string().nullable(),
      actor: z.string(),
      createdAt: z.string(),
    }),
  ),
});
export type DealDetail = z.infer<typeof dealDetailSchema>;
const customerDealsSchema = z.array(
  z.object({
    id: recordId,
    name: z.string(),
    pipelineId: recordId,
    pipeline: z.string(),
    stage: z.string(),
    category,
    amount: z.string().nullable(),
    currency: z.string().nullable(),
    archived: z.boolean(),
  }),
);

export type DealFilter = { q: string; archived: boolean };
export type DealSort = "position" | "name" | "-amount" | "close" | "-created";

const get = async <T>(
  path: string,
  schema: z.ZodType<T>,
  signal?: AbortSignal,
) => schema.parse((await apiRequest(path, { signal, cache: "no-store" })).data);
const asQuery = (value: object) =>
  `query=${encodeURIComponent(JSON.stringify(value))}`;

export function usePipeline(
  scope: CrmScope,
  boardId: string,
  syncInterval?: number,
) {
  return useQuery({
    queryKey: [...crmKeys.board(scope), "pipeline", boardId] as const,
    refetchInterval: syncInterval,
    queryFn: ({ signal }) =>
      get(
        `/api/v1/crm/pipeline?boardId=${boardId}`,
        pipelineSummarySchema,
        signal,
      ),
  });
}
export function usePipelines(principalId: string, workspaceId: string) {
  return useQuery({
    queryKey: ["principal", principalId, "crm-pipelines", workspaceId] as const,
    queryFn: ({ signal }) =>
      get(
        `/api/v1/crm/pipelines?workspaceId=${workspaceId}`,
        pipelineListSchema,
        signal,
      ),
  });
}
export function useDealLanes(
  scope: CrmScope,
  boardId: string,
  filter: DealFilter,
  syncInterval: number,
  enabled: boolean,
) {
  return useQuery({
    queryKey: [...crmKeys.board(scope), "deal-lanes", boardId, filter] as const,
    enabled,
    placeholderData: keepPreviousData,
    refetchInterval: syncInterval,
    refetchIntervalInBackground: false,
    queryFn: ({ signal }) =>
      get(
        `/api/v1/crm/deal-lanes?${asQuery({ boardId, ...filter })}`,
        lanesSchema,
        signal,
      ),
  });
}
export function useDealList(
  scope: CrmScope,
  boardId: string,
  filter: DealFilter & { sort: DealSort; page: number },
  syncInterval: number,
  enabled: boolean,
) {
  return useQuery({
    queryKey: [...crmKeys.board(scope), "deal-list", boardId, filter] as const,
    enabled,
    placeholderData: keepPreviousData,
    refetchInterval: syncInterval,
    refetchIntervalInBackground: false,
    queryFn: ({ signal }) =>
      get(
        `/api/v1/crm/deals?${asQuery({ boardId, ...filter })}`,
        listSchema,
        signal,
      ),
  });
}
export function useDeal(scope: CrmScope, dealId: string | null) {
  return useQuery({
    queryKey: [...crmKeys.board(scope), "deal", dealId ?? "none"] as const,
    enabled: Boolean(dealId),
    queryFn: ({ signal }) =>
      get(`/api/v1/crm/deal?recordId=${dealId}`, dealDetailSchema, signal),
  });
}
export function useCustomerDeals(scope: CrmScope, recordId: string) {
  return useQuery({
    queryKey: [...crmKeys.board(scope), "customer-deals", recordId] as const,
    queryFn: ({ signal }) =>
      get(
        `/api/v1/crm/customer-deals?recordId=${recordId}`,
        customerDealsSchema,
        signal,
      ),
  });
}

/** Adds a deal to a pipeline, in a chosen stage or the default one. */
export function useCreateDeal(scope: CrmScope) {
  const client = useQueryClient();
  return useMutation({
    mutationKey: crmKeys.board(scope),
    mutationFn: async (input: {
      boardId: string;
      name: string;
      stageId?: string;
    }) =>
      taskMutationResultSchema.parse(
        (
          await apiRequest("/api/v1/boards/create-task", {
            method: "POST",
            json: { ...input, createKey: crypto.randomUUID() },
          })
        ).data,
      ),
    onSettled: () =>
      client.invalidateQueries({ queryKey: crmKeys.board(scope) }),
  });
}

/** Moves a deal's card at once; the server answer (or a conflict) wins. */
export function moveCachedDeal(
  client: ReturnType<typeof useQueryClient>,
  scope: CrmScope,
  dealId: string,
  stageId: string,
) {
  client.setQueriesData<DealLanes>(
    { queryKey: [...crmKeys.board(scope), "deal-lanes"] },
    (data) => {
      if (!data) return data;
      const deal = data.lanes
        .flatMap((lane) => lane.deals)
        .find((item) => item.id === dealId);
      if (!deal) return data;
      return {
        ...data,
        lanes: data.lanes.map((lane) => {
          const without = lane.deals.filter((item) => item.id !== dealId);
          const removed = without.length !== lane.deals.length;
          if (lane.stageId === stageId)
            return {
              ...lane,
              total: lane.total + (removed ? 0 : 1),
              deals: [...without, { ...deal, stageId }],
            };
          return removed
            ? { ...lane, total: lane.total - 1, deals: without }
            : lane;
        }),
      };
    },
  );
}

export function useStageCommand(scope: CrmScope) {
  const client = useQueryClient();
  return useMutation({
    mutationKey: crmKeys.board(scope),
    mutationFn: async (command: StageCommand) =>
      (
        await apiRequest<{ boardId: string; version: number }>(
          "/api/v1/crm/stages",
          { method: "POST", json: command },
        )
      ).data,
    onSettled: () =>
      client.invalidateQueries({ queryKey: crmKeys.board(scope) }),
  });
}
export function useCreatePipeline(principalId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (input: { workspaceId: string; name: string }) =>
      (
        await apiRequest<{ boardId: string }>("/api/v1/crm/pipeline", {
          method: "POST",
          json: input,
        })
      ).data,
    onSettled: () =>
      client.invalidateQueries({
        queryKey: ["principal", principalId, "crm-pipelines"],
      }),
  });
}

/** "₱12,500", "$5.25": a deal value in its own currency. */
export function money(amount: string | null, currency: string | null) {
  if (amount === null || !currency) return null;
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: amount.includes(".") ? 2 : 0,
    }).format(Number(amount));
  } catch {
    return `${currency} ${amount}`;
  }
}
/** Totals per currency, joined: "₱1,985,000 · $18,000". */
export const moneyTotals = (totals: Record<string, string>) =>
  Object.entries(totals)
    .map(([currency, amount]) => money(amount, currency))
    .join(" · ");
