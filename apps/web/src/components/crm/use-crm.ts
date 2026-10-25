"use client";
import { useRef } from "react";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { ApiError, apiRequest } from "@/lib/api-client";
import { taskMutationResultSchema } from "@/lib/approval-contract";
import {
  crmDirectorySchema,
  crmLinksSchema,
  crmMatchesSchema,
  crmRecordDetailSchema,
  linkResultSchema,
  type CrmDirectory,
  type CrmRecord,
  type ProfileKey,
} from "@/lib/crm-contract";

export type CrmType = "COMPANY" | "CONTACT";
export type CrmScope = {
  principalId: string;
  workspaceId: string;
  boardId: string;
  type: CrmType;
};
export type DirectoryQuery = {
  q: string;
  archived: boolean;
  sort: "name" | "-name" | "created" | "-created";
  page: number;
};
/** Changes a person can make to a record from the grid or its card. */
export type CrmChanges = Partial<Record<ProfileKey, string | null>> & {
  name?: string;
  description?: string;
  assigneeIds?: string[];
};

// Under the board's key, so live board events and comment/file changes
// refresh CRM screens without a reload.
export const crmKeys = {
  board: ({ principalId, boardId }: CrmScope) =>
    ["principal", principalId, "boards", boardId] as const,
  directory: (scope: CrmScope, query?: DirectoryQuery) =>
    [
      ...crmKeys.board(scope),
      "crm-directory",
      ...(query ? [query] : []),
    ] as const,
  record: (scope: CrmScope, recordId: string) =>
    [...crmKeys.board(scope), "crm-record", recordId] as const,
};

export function useCrmDirectory(
  scope: CrmScope,
  query: DirectoryQuery,
  syncInterval: number,
) {
  return useQuery({
    queryKey: crmKeys.directory(scope, query),
    placeholderData: keepPreviousData,
    refetchInterval: syncInterval,
    refetchIntervalInBackground: false,
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({
        workspaceId: scope.workspaceId,
        query: JSON.stringify({ type: scope.type, ...query }),
      });
      return crmDirectorySchema.parse(
        (
          await apiRequest(`/api/v1/crm/directory?${params}`, {
            signal,
            cache: "no-store",
          })
        ).data,
      );
    },
  });
}

export function useCrmRecord(scope: CrmScope, recordId: string | null) {
  return useQuery({
    queryKey: crmKeys.record(scope, recordId ?? "none"),
    enabled: Boolean(recordId),
    queryFn: async ({ signal }) =>
      crmRecordDetailSchema.parse(
        (
          await apiRequest(`/api/v1/crm/record?recordId=${recordId}`, {
            signal,
            cache: "no-store",
          })
        ).data,
      ),
  });
}

export function useCrmMatches(
  scope: CrmScope,
  input: { name: string; email?: string; domain?: string; exclude?: string },
) {
  const name = input.name.trim();
  return useQuery({
    queryKey: [...crmKeys.board(scope), "crm-matches", input] as const,
    enabled: name.length >= 3 || Boolean(input.email) || Boolean(input.domain),
    staleTime: 10_000,
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({
        workspaceId: scope.workspaceId,
        query: JSON.stringify({ type: scope.type, ...input, name }),
      });
      return crmMatchesSchema.parse(
        (
          await apiRequest(`/api/v1/crm/matches?${params}`, {
            signal,
            cache: "no-store",
          })
        ).data,
      );
    },
  });
}

/** Writes a record's changes in every cached directory page that has it. */
function patchCached(
  client: ReturnType<typeof useQueryClient>,
  scope: CrmScope,
  id: string,
  patch: (record: CrmRecord) => CrmRecord,
) {
  client.setQueriesData<CrmDirectory>(
    { queryKey: crmKeys.directory(scope) },
    (page) =>
      page && {
        ...page,
        records: page.records.map((record) =>
          record.id === id ? patch(record) : record,
        ),
      },
  );
}
const applyChanges = (record: CrmRecord, changes: CrmChanges): CrmRecord => {
  const { name, description, assigneeIds, ...profile } = changes;
  return {
    ...record,
    ...(name !== undefined ? { name } : {}),
    ...(description !== undefined ? { description } : {}),
    ...(assigneeIds !== undefined ? { ownerId: assigneeIds[0] ?? null } : {}),
    profile: { ...record.profile, ...profile },
  };
};

export type SaveOutcome = "APPLIED" | "PENDING_APPROVAL";

/** Saves record changes against the revision the person was looking at. A
 *  stale revision is a conflict that reloads the latest values; it never
 *  overwrites someone else's edit. One person's quick edits to the same
 *  record run in order, each after the revision their previous save made. */
export function useCrmSave(scope: CrmScope) {
  const client = useQueryClient();
  const queues = useRef(new Map<string, Promise<unknown>>());
  const revisions = useRef(new Map<string, number>());
  return useMutation({
    mutationKey: crmKeys.board(scope),
    mutationFn: (input: {
      record: Pick<CrmRecord, "id" | "revision">;
      changes: CrmChanges;
    }) => {
      const id = input.record.id;
      const run = async () => {
        const revision = Math.max(
          input.record.revision,
          revisions.current.get(id) ?? 0,
        );
        const result = taskMutationResultSchema.parse(
          (
            await apiRequest("/api/v1/boards/update", {
              method: "POST",
              json: {
                taskId: id,
                revision,
                requestKey: crypto.randomUUID(),
                changes: input.changes,
              },
            })
          ).data,
        );
        if (result.outcome === "APPLIED")
          revisions.current.set(id, result.revision);
        return result;
      };
      const next = (queues.current.get(id) ?? Promise.resolve())
        .catch(() => undefined)
        .then(run);
      queues.current.set(id, next);
      return next;
    },
    onMutate: async ({ record, changes }) => {
      await client.cancelQueries({ queryKey: crmKeys.directory(scope) });
      patchCached(client, scope, record.id, (current) =>
        applyChanges(current, changes),
      );
    },
    onSettled: () =>
      client.invalidateQueries({ queryKey: crmKeys.board(scope) }),
  });
}

export function useCrmCreate(scope: CrmScope) {
  const client = useQueryClient();
  return useMutation({
    mutationKey: crmKeys.board(scope),
    mutationFn: async (input: { name: string; createKey: string }) =>
      taskMutationResultSchema.parse(
        (
          await apiRequest("/api/v1/boards/create-task", {
            method: "POST",
            json: { boardId: scope.boardId, ...input },
          })
        ).data,
      ),
    onSettled: () =>
      client.invalidateQueries({ queryKey: crmKeys.board(scope) }),
  });
}

export type LifecycleAction = "archive" | "restore" | "delete";
export function useCrmLifecycle(scope: CrmScope) {
  const client = useQueryClient();
  return useMutation({
    mutationKey: crmKeys.board(scope),
    mutationFn: async ({
      action,
      record,
    }: {
      action: LifecycleAction;
      record: Pick<CrmRecord, "id" | "revision">;
    }) =>
      action === "delete"
        ? apiRequest("/api/v1/trash/delete-record", {
            method: "POST",
            json: { id: record.id, revision: record.revision },
          })
        : apiRequest(`/api/v1/boards/${action}`, {
            method: "POST",
            json: {
              taskId: record.id,
              revision: record.revision,
              requestKey: crypto.randomUUID(),
            },
          }),
    onSettled: () =>
      client.invalidateQueries({ queryKey: crmKeys.board(scope) }),
  });
}

/** A person-facing sentence for a failed save. */
export function saveError(error: unknown) {
  if (error instanceof ApiError && error.code === "TASK_CHANGED")
    return "Someone else changed this record. The latest version is showing now.";
  return error instanceof Error
    ? error.message
    : "This change could not be saved.";
}

/** A record's links: a contact's companies or a company's people. */
export function useCrmLinks(
  scope: CrmScope,
  recordId: string,
  page: number,
  syncInterval: number,
) {
  return useQuery({
    queryKey: [...crmKeys.board(scope), "crm-links", recordId, page] as const,
    placeholderData: keepPreviousData,
    refetchInterval: syncInterval,
    refetchIntervalInBackground: false,
    queryFn: async ({ signal }) =>
      crmLinksSchema.parse(
        (
          await apiRequest(
            `/api/v1/crm/links?recordId=${recordId}&page=${page}`,
            { signal, cache: "no-store" },
          )
        ).data,
      ),
  });
}

/** Records of one type to pick from when linking, by name, domain or email. */
export function useCrmPicker(
  scope: CrmScope,
  type: CrmType,
  q: string,
  enabled: boolean,
) {
  return useQuery({
    queryKey: [...crmKeys.board(scope), "crm-picker", type, q] as const,
    enabled,
    staleTime: 10_000,
    placeholderData: keepPreviousData,
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams({
        workspaceId: scope.workspaceId,
        query: JSON.stringify({ type, q }),
      });
      return crmDirectorySchema.parse(
        (
          await apiRequest(`/api/v1/crm/directory?${params}`, {
            signal,
            cache: "no-store",
          })
        ).data,
      ).records;
    },
  });
}

export type LinkCommand =
  | {
      action: "link";
      body: {
        contactId: string;
        companyId: string;
        role?: string | null;
        status?: "CURRENT" | "FORMER";
      };
    }
  | {
      action: "update-link";
      body: {
        linkId: string;
        revision: number;
        changes: { role?: string | null; status?: "CURRENT" | "FORMER" };
        clearPrimary?: boolean;
        primaryRevision?: number;
      };
    }
  | {
      action: "remove-link";
      body: {
        linkId: string;
        revision: number;
        clearPrimary?: boolean;
        primaryRevision?: number;
      };
    }
  | {
      action: "primary";
      body: {
        contactId: string;
        linkId: string | null;
        linkRevision?: number;
        primaryRevision: number;
      };
    };

/** Contact–Company link changes; each carries its own request key. */
export function useCrmLinkCommand(scope: CrmScope) {
  const client = useQueryClient();
  return useMutation({
    mutationKey: crmKeys.board(scope),
    mutationFn: async (command: LinkCommand) =>
      linkResultSchema.parse(
        (
          await apiRequest(`/api/v1/crm/${command.action}`, {
            method: "POST",
            json: { ...command.body, requestKey: crypto.randomUUID() },
          })
        ).data,
      ),
    onSettled: () =>
      client.invalidateQueries({ queryKey: crmKeys.board(scope) }),
  });
}
