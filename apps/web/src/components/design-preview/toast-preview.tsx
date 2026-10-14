"use client";
import { useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ModeSwitcher } from "@/components/appearance/theme-runtime";
import {
  YuzuToast,
  ToastVisual,
  type YuzuToastNotice,
} from "@/components/ui/yuzu-toast";
const samples: YuzuToastNotice[] = [
  {
    id: "info",
    kind: "info",
    title: "Information",
    message: "Your changes have been saved.",
  },
  {
    id: "success",
    kind: "success",
    title: "Success",
    message: "Your team’s next step is ready.",
  },
  {
    id: "warning",
    kind: "warning",
    title: "Warning",
    message: "Review this change before continuing.",
  },
  {
    id: "error",
    kind: "error",
    title: "Error",
    message: "The change could not be saved. Try again.",
  },
  {
    id: "loading",
    kind: "loading",
    icon: "download",
    title: "Downloading",
    message: "Example file · progress preview",
    progress: 26,
    duration: null,
  },
  {
    id: "neutral",
    kind: "neutral",
    icon: "copy",
    title: "Copied!",
    message: "The link has been copied to your clipboard.",
  },
  {
    id: "settings",
    kind: "success",
    title: "Settings updated",
    message: "Your preferences have been saved.",
  },
  {
    id: "action",
    kind: "info",
    title: "New version available",
    message: "An example notification with an action.",
  },
  {
    id: "night",
    kind: "neutral",
    icon: "moon",
    title: "Night mode",
    message: "The design follows your chosen theme.",
  },
];
export function ToastPreview() {
  const [notice, setNotice] = useState<YuzuToastNotice | null>(null);
  const [duration, setDuration] = useState(5000);
  const [actionUsed, setActionUsed] = useState(false);
  const [visible, setVisible] = useState(samples.map((sample) => sample.id));
  const show = (sample: YuzuToastNotice) =>
    setNotice({
      ...sample,
      id: crypto.randomUUID(),
      duration: sample.kind === "loading" ? null : duration,
      ...(sample.id === "action"
        ? {
            action: {
              label: "Try action",
              altText: "Run the example action",
              onClick: () => setActionUsed(true),
            },
          }
        : {}),
    });
  return (
    <main className="toast-design-preview">
      <header className="toast-preview-header">
        <div>
          <h1>Yuzu notifications</h1>
          <p>Leaf corners, citrus details, and clear feedback for your team.</p>
        </div>
        <ModeSwitcher />
      </header>
      <p className="toast-preview-note">
        Design preview. These examples do not change workspace data.
      </p>
      <div className="toast-preview-layout">
        <section className="toast-preview-grid" aria-label="Toast examples">
          {samples
            .filter((sample) => visible.includes(sample.id))
            .map((sample) => (
              <article
                key={sample.id}
                className="yuzu-toast"
                data-variant={sample.kind}
              >
                <ToastVisual
                  notice={sample}
                  action={
                    sample.id === "action" && (
                      <button
                        className="yuzu-toast-action"
                        onClick={() => show(sample)}
                      >
                        Try action
                      </button>
                    )
                  }
                  close={
                    <button
                      className="yuzu-toast-close"
                      aria-label={`Hide ${sample.title} example`}
                      onClick={() =>
                        setVisible(visible.filter((id) => id !== sample.id))
                      }
                    >
                      <X size={13} />
                    </button>
                  }
                />
              </article>
            ))}
        </section>
        <aside className="toast-preview-controls">
          <h2>Try a notification</h2>
          <div className="flex flex-wrap gap-2">
            {samples.slice(0, 6).map((sample) => (
              <Button
                key={sample.id}
                size="sm"
                variant="outline"
                onClick={() => show(sample)}
              >
                Show {sample.kind}
              </Button>
            ))}
          </div>
          <label className="task-field-label mt-5">
            Auto dismiss
            <select
              aria-label="Toast duration"
              className="task-select"
              value={duration}
              onChange={(event) => setDuration(Number(event.target.value))}
            >
              <option value={2000}>2 seconds</option>
              <option value={5000}>5 seconds</option>
              <option value={10000}>10 seconds</option>
            </select>
          </label>
          <Button
            className="mt-4"
            variant="outline"
            size="sm"
            onClick={() =>
              show(samples.find((sample) => sample.id === "action")!)
            }
          >
            Show action
          </Button>
          <Button
            className="mt-4"
            variant="outline"
            size="sm"
            disabled={notice?.kind !== "loading"}
            onClick={() =>
              setNotice((current) => current && { ...current, progress: 75 })
            }
          >
            Advance progress
          </Button>
          <Button
            className="mt-4"
            variant="ghost"
            size="sm"
            onClick={() => setVisible(samples.map((sample) => sample.id))}
          >
            Restore examples
          </Button>
          {actionUsed && (
            <p role="status" className="mt-4 text-sm">
              Preview action completed.
            </p>
          )}
          <dl className="toast-preview-behavior">
            <dt>Position</dt>
            <dd>Top right</dd>
            <dt>Duration</dt>
            <dd>5 seconds by default; configurable</dd>
            <dt>Motion</dt>
            <dd>Slide and fade; reduced motion supported</dd>
            <dt>Theme</dt>
            <dd>Uses Yuzu’s active colors and typography</dd>
          </dl>
        </aside>
      </div>
      <YuzuToast notice={notice} />
    </main>
  );
}
