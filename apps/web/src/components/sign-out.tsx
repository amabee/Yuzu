"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "nextjs-toploader/app";
import { LogOut } from "lucide-react";
import { apiRequest } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { useUiStore } from "./providers";

export function SignOut() {
  const cache = useQueryClient();
  const router = useRouter();
  const reset = useUiStore((state) => state.reset);
  const action = useMutation({
    mutationFn: () =>
      apiRequest("/api/v1/session/sign-out", { method: "POST", json: {} }),
    onSuccess: async () => {
      await cache.cancelQueries();
      cache.clear();
      reset();
      router.replace("/sign-in");
      router.refresh();
    },
  });
  return (
    <div>
      <Button
        size="icon"
        variant="ghost"
        aria-label="Sign out"
        onClick={() => action.mutate()}
        disabled={action.isPending}
      >
        <LogOut size={17} />
      </Button>
      {action.error && (
        <span role="alert" className="text-xs text-destructive">
          Sign-out failed. Retry.
        </span>
      )}
    </div>
  );
}
