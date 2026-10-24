import { getDatabase, type Prisma } from "@yuzu/database";
import {
  navigationSearchQuerySchema,
  NAVIGATION_SEARCH_PAGE_SIZE,
  type NavigationSearchResult,
} from "@/lib/navigation-search-contract";
import { escapeLike } from "@/lib/board-query";
import { requireIdentity, boardScope, projectScope } from "./team-access";

/** Navigation search must include archived resources absent from sidebar data. */
export async function searchNavigation(
  headers: Headers,
  input: unknown,
): Promise<NavigationSearchResult> {
  const query = navigationSearchQuerySchema.parse(input);
  const { user } = await requireIdentity(headers);
  const name = { contains: escapeLike(query.q), mode: "insensitive" as const };
  const archived = query.archived === "true";
  return getDatabase().$transaction(
    async (tx) => {
      if (query.kind === "project") {
        const where: Prisma.ProjectWhereInput = {
          ...projectScope(user),
          archivedAt: archived ? { not: null } : null,
          ...(query.q
            ? { AND: [{ OR: [{ name }, { workspace: { name } }] }] }
            : {}),
        };
        const total = await tx.project.count({ where });
        const rows = await tx.project.findMany({
          where: {
            ...where,
            ...(query.cursor ? { id: { lt: query.cursor } } : {}),
          },
          take: NAVIGATION_SEARCH_PAGE_SIZE + 1,
          orderBy: { id: "desc" },
          select: {
            id: true,
            name: true,
            archivedAt: true,
            workspace: { select: { name: true } },
          },
        });
        const page = rows.slice(0, NAVIGATION_SEARCH_PAGE_SIZE);
        return {
          total,
          nextCursor:
            rows.length > NAVIGATION_SEARCH_PAGE_SIZE ? page.at(-1)!.id : null,
          items: page.map((row) => ({
            id: row.id,
            name: row.name,
            archived: Boolean(row.archivedAt),
            workspaceName: row.workspace.name,
            projectName: null,
          })),
        };
      }
      // Independent archive and inherited project archive share one archive mode.
      const where: Prisma.BoardWhereInput = {
        AND: [
          boardScope(user),
          archived
            ? {
                OR: [
                  { archivedAt: { not: null } },
                  { project: { is: { archivedAt: { not: null } } } },
                ],
              }
            : {
                archivedAt: null,
                OR: [
                  { projectId: null },
                  { project: { is: { archivedAt: null } } },
                ],
              },
          ...(query.q
            ? [
                {
                  OR: [
                    { name },
                    { workspace: { name } },
                    { project: { is: { name } } },
                  ],
                },
              ]
            : []),
        ],
      };
      const total = await tx.board.count({ where });
      const rows = await tx.board.findMany({
        where: {
          ...where,
          ...(query.cursor ? { id: { lt: query.cursor } } : {}),
        },
        take: NAVIGATION_SEARCH_PAGE_SIZE + 1,
        orderBy: { id: "desc" },
        select: {
          id: true,
          name: true,
          archivedAt: true,
          workspace: { select: { name: true } },
          project: { select: { name: true, archivedAt: true } },
        },
      });
      const page = rows.slice(0, NAVIGATION_SEARCH_PAGE_SIZE);
      return {
        total,
        nextCursor:
          rows.length > NAVIGATION_SEARCH_PAGE_SIZE ? page.at(-1)!.id : null,
        items: page.map((row) => ({
          id: row.id,
          name: row.name,
          archived: Boolean(row.archivedAt || row.project?.archivedAt),
          archiveSource: row.archivedAt
            ? "board"
            : row.project?.archivedAt
              ? "project"
              : null,
          workspaceName: row.workspace.name,
          projectName: row.project?.name ?? null,
        })),
      };
    },
    { isolationLevel: "RepeatableRead", timeout: 15000 },
  );
}
