import { QueryClient } from "@tanstack/react-query";
import { retryQuery } from "./api-client";

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { staleTime: 30_000, retry: retryQuery },
      mutations: { retry: false },
    },
  });
}

// Authenticated feature keys must include principal identity; never include a secret.
export const queryKeys = {
  board: (principalId: string, workspaceId: string, boardId: string) =>
    [
      "principal",
      principalId,
      "workspace",
      workspaceId,
      "board",
      boardId,
    ] as const,
};
