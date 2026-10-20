"use client";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useRouter } from "nextjs-toploader/app";
import { apiRequest } from "@/lib/api-client";

const common = ["PHP", "USD", "EUR", "GBP", "SGD", "JPY", "AUD", "CAD"];

/** Owners and admins choose the currency that currency fields show. */
export function CurrencySetting({
  currency,
  revision,
}: {
  currency: string;
  revision: number;
}) {
  const router = useRouter();
  const [saved, setSaved] = useState(false);
  const save = useMutation({
    mutationFn: async (value: string) =>
      (
        await apiRequest("/api/v1/settings/currency", {
          method: "POST",
          json: { currency: value, revision },
        })
      ).data,
    onSuccess: () => {
      setSaved(true);
      router.refresh();
    },
  });
  const choices = common.includes(currency) ? common : [currency, ...common];
  return (
    <div className="grid gap-1.5">
      <label className="flex items-center gap-3 text-sm">
        Currency
        <select
          aria-label="Currency"
          className="task-select project-role-select"
          value={currency}
          disabled={save.isPending}
          onChange={(event) => {
            setSaved(false);
            save.mutate(event.target.value);
          }}
        >
          {choices.map((code) => (
            <option key={code} value={code}>
              {code}
            </option>
          ))}
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
          "Saved. Currency fields use it everywhere."
        ) : null}
      </p>
    </div>
  );
}
