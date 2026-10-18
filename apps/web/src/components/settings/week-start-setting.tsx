"use client";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useRouter } from "nextjs-toploader/app";
import { apiRequest } from "@/lib/api-client";

/** Owners and admins choose the first day of calendar weeks for everyone. */
export function WeekStartSetting({
  weekStartsOn,
  revision,
}: {
  weekStartsOn: 0 | 1;
  revision: number;
}) {
  const router = useRouter();
  const [saved, setSaved] = useState(false);
  const save = useMutation({
    mutationFn: async (value: 0 | 1) =>
      (
        await apiRequest("/api/v1/settings/calendar", {
          method: "POST",
          json: { weekStartsOn: value, revision },
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
        Weeks start on
        <select
          aria-label="Weeks start on"
          className="task-select project-role-select"
          value={weekStartsOn}
          disabled={save.isPending}
          onChange={(event) => {
            setSaved(false);
            save.mutate(Number(event.target.value) as 0 | 1);
          }}
        >
          <option value={1}>Monday</option>
          <option value={0}>Sunday</option>
        </select>
      </label>
      <p
        role="status"
        aria-live="polite"
        className="text-xs text-muted-foreground"
      >
        {save.error ? (
          <span className="text-destructive">{save.error.message}</span>
        ) : saved ? (
          "Saved. Calendars use the new week start."
        ) : null}
      </p>
    </div>
  );
}
