import { z } from "zod";
import { recordId } from "./id-contract";

/**
 * "Link to board" fields and rollups through them.
 * See docs/specs/record-foundation.md (slice 1b).
 */
export const MAX_LINKS_PER_FIELD = 100;
export const LINK_OPTIONS_LIMIT = 20;

/** Stored on a RELATION column. `primary` owns the link rows; its mirror
 *  on the other board reads them in reverse. */
export const relationConfigSchema = z.object({
  targetBoardId: recordId,
  many: z.boolean(),
  mirrorFieldId: recordId,
  primary: z.boolean(),
});
export type RelationConfig = z.infer<typeof relationConfigSchema>;
export const relationConfig = (config: unknown): RelationConfig | null => {
  const parsed = relationConfigSchema.safeParse(config);
  return parsed.success ? parsed.data : null;
};

export const rollupAggregates = ["count", "sum"] as const;
export type RollupAggregate = (typeof rollupAggregates)[number];
/** Stored on a ROLLUP column. */
export const rollupConfigSchema = z.object({
  relationFieldId: recordId,
  aggregate: z.enum(rollupAggregates),
  /** For sums: a number field on the linked board. */
  targetFieldId: recordId.nullable(),
  /** The summed field's display, copied so the rollup reads the same. */
  format: z.enum(["plain", "currency", "percent"]).default("plain"),
  decimals: z.number().int().min(0).max(4).optional(),
});
export type RollupConfig = z.infer<typeof rollupConfigSchema>;
export const rollupConfig = (config: unknown): RollupConfig | null => {
  const parsed = rollupConfigSchema.safeParse(config);
  return parsed.success ? parsed.data : null;
};

/** What a new link field or rollup needs when it's created. */
export const relationFieldInput = z.strictObject({
  targetBoardId: recordId,
  /** Each record here links to many (true) or one (false) on the other board. */
  many: z.boolean(),
  /** The same, seen from the other board. */
  mirrorMany: z.boolean(),
  mirrorName: z.string().trim().min(1).max(80),
});
export const rollupFieldInput = z.strictObject({
  relationFieldId: recordId,
  aggregate: z.enum(rollupAggregates),
  targetFieldId: recordId.nullable().default(null),
});

/** A linked record as the viewer may see it; absent means "Private item". */
export type LinkedRecord = {
  name: string;
  boardId: string;
  archived: boolean;
};

/** Count or sum over the linked records the viewer can see. */
export function aggregateLinks(
  ids: string[],
  linked: Record<string, LinkedRecord | undefined>,
  config: Pick<RollupConfig, "aggregate">,
  numbers: Record<string, number | undefined> = {},
) {
  const counted = ids.filter((id) => linked[id] && !linked[id]!.archived);
  if (config.aggregate === "count") return counted.length;
  return counted.reduce((total, id) => total + (numbers[id] ?? 0), 0);
}
