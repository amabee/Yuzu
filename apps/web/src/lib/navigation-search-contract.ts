import { z } from "zod";
import { recordId } from "./id-contract";
export const NAVIGATION_SEARCH_PAGE_SIZE = 20;
export const navigationSearchQuerySchema = z.strictObject({
  kind: z.enum(["board", "project"]),
  q: z.string().trim().max(200).default(""),
  archived: z.enum(["false", "true"]).default("false"),
  cursor: recordId.optional(),
});
export const navigationSearchResultSchema = z.object({
  items: z
    .array(
      z.object({
        id: recordId,
        name: z.string(),
        workspaceName: z.string(),
        projectName: z.string().nullable(),
        archived: z.boolean(),
        archiveSource: z.enum(["board", "project"]).nullable().optional(),
      }),
    )
    .max(NAVIGATION_SEARCH_PAGE_SIZE),
  total: z.number().int().nonnegative(),
  nextCursor: recordId.nullable(),
});
export type NavigationSearchResult = z.infer<
  typeof navigationSearchResultSchema
>;
