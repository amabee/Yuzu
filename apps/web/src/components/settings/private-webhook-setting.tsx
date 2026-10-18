"use client";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useRouter } from "nextjs-toploader/app";
import { apiRequest } from "@/lib/api-client";
import { Switch } from "@/components/ui/switch";

/** Owners and admins decide whether webhooks may reach the local network. */
export function PrivateWebhookSetting({
  allowed,
  revision,
}: {
  allowed: boolean;
  revision: number;
}) {
  const router = useRouter();
  const [saved, setSaved] = useState(false);
  const save = useMutation({
    mutationFn: async (value: boolean) =>
      (
        await apiRequest("/api/v1/settings/automation", {
          method: "POST",
          json: { allowPrivateWebhooks: value, revision },
        })
      ).data,
    onSuccess: () => {
      setSaved(true);
      router.refresh();
    },
  });
  return (
    <div className="grid gap-1.5">
      <label className="flex items-center gap-3 text-sm">
        Allow local-network webhooks
        <Switch
          aria-label="Allow local-network webhooks"
          checked={allowed}
          disabled={save.isPending}
          onCheckedChange={(value) => {
            setSaved(false);
            save.mutate(value);
          }}
        />
      </label>
      <p
        role="status"
        aria-live="polite"
        className="text-xs text-muted-foreground"
      >
        {save.error ? (
          <span className="text-destructive">{save.error.message}</span>
        ) : saved ? (
          "Saved."
        ) : null}
      </p>
    </div>
  );
}
