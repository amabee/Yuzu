"use client";
import { useMutation } from "@tanstack/react-query";
import { useRouter } from "nextjs-toploader/app";
import { apiRequest } from "@/lib/api-client";

/** POSTs a project action, then refreshes the server-rendered navigation and
 *  page so the sidebar and project views pick up the change. */
export function useProjectAction<T = unknown, V = unknown>(
  action: string,
  onDone?: (data: T, variables: V) => void,
) {
  const router = useRouter();
  return useMutation({
    mutationFn: async (json: V) =>
      (
        await apiRequest<T>(`/api/v1/projects/${action}`, {
          method: "POST",
          json,
        })
      ).data,
    onSuccess: (data, variables) => {
      onDone?.(data, variables);
      router.refresh();
    },
  });
}
