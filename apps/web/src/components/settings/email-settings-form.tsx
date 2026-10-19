"use client";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/api-client";
import {
  emailSettingsSchema,
  type EmailDelivery,
  type EmailSettings,
} from "@/lib/email-contract";
import { Switch } from "@/components/ui/switch";
import { PauseAlert } from "@/components/pause/pause-alert";
import { PauseSheetDecor } from "@/components/pause/pause-sheet";

const deliveryLabel: Record<EmailDelivery, string> = {
  INSTANT: "Instantly",
  DIGEST: "Daily",
  OFF: "Off",
};

/** Each person's email choices; every change saves straight away. */
export function EmailSettingsForm({ initial }: { initial: EmailSettings }) {
  const [settings, setSettings] = useState(initial);
  // The time to restore when the digest is switched back on.
  const [lastTime, setLastTime] = useState(initial.digestTime ?? "08:00");
  const save = useMutation({
    mutationFn: async (next: EmailSettings) =>
      emailSettingsSchema.parse(
        (
          await apiRequest("/api/v1/email/settings", {
            method: "POST",
            json: {
              preferences: next.preferences.map(({ kind, delivery }) => ({
                kind,
                delivery,
              })),
              digestTime: next.digestTime,
            },
          })
        ).data,
      ),
    onSuccess: (saved) => setSettings(saved),
    onError: () => setSettings(initial),
  });
  const change = (next: EmailSettings) => {
    setSettings(next);
    save.mutate(next);
  };
  const digestOn = settings.digestTime !== null;
  return (
    <section className="email-settings">
      <PauseSheetDecor />
      <div className="email-settings-body">
        <h1>Email notifications</h1>
        <p className="email-settings-sub">
          Choose what reaches your inbox. Everything still shows in Yuzu.
        </p>
        {!settings.emailReady && (
          <PauseAlert intent="info" className="mt-4">
            Email isn&apos;t set up for this installation yet, so nothing is
            sent. Your choices are saved for when it is.
          </PauseAlert>
        )}
        <ul className="email-settings-rows">
          {settings.preferences.map((item) => (
            <li key={item.kind}>
              <div>
                <b>{item.label}</b>
                <small>{item.hint}</small>
              </div>
              <span
                className="email-settings-seg"
                role="radiogroup"
                aria-label={`${item.label} emails`}
              >
                {(["INSTANT", "DIGEST", "OFF"] as const).map((delivery) => (
                  <button
                    key={delivery}
                    type="button"
                    role="radio"
                    aria-checked={item.delivery === delivery}
                    disabled={save.isPending}
                    onClick={() =>
                      item.delivery !== delivery &&
                      change({
                        ...settings,
                        preferences: settings.preferences.map((row) =>
                          row.kind === item.kind ? { ...row, delivery } : row,
                        ),
                      })
                    }
                  >
                    {deliveryLabel[delivery]}
                  </button>
                ))}
              </span>
            </li>
          ))}
        </ul>
        <div className="email-settings-digest">
          <b>Daily digest</b>
          {digestOn ? (
            <>
              <span>arrives at</span>
              <input
                type="time"
                aria-label="Digest time"
                value={settings.digestTime ?? lastTime}
                disabled={save.isPending}
                onChange={(event) => {
                  if (!event.target.value) return;
                  setLastTime(event.target.value);
                  change({ ...settings, digestTime: event.target.value });
                }}
              />
              <small>{settings.timezone}</small>
            </>
          ) : (
            <span>is off</span>
          )}
          <Switch
            className="ml-auto"
            aria-label="Daily digest"
            checked={digestOn}
            disabled={save.isPending}
            onCheckedChange={(on) =>
              change({ ...settings, digestTime: on ? lastTime : null })
            }
          />
        </div>
        <p className="email-settings-note">
          Instant emails wait 5 minutes. If you&apos;ve already opened the
          notification in Yuzu, we don&apos;t send it.
        </p>
        <p role="status" aria-live="polite" className="email-settings-status">
          {save.error ? (
            <span className="text-destructive">{save.error.message}</span>
          ) : save.isSuccess ? (
            "Saved."
          ) : null}
        </p>
      </div>
    </section>
  );
}
