"use client";
import type { ReactNode } from "react";
import { Toast } from "radix-ui";
import {
  Info,
  CheckCircle2,
  TriangleAlert,
  CircleAlert,
  Bell,
  LoaderCircle,
  Download,
  Upload,
  Copy,
  Moon,
  X,
} from "lucide-react";
export type ToastVariant =
  | "info"
  | "success"
  | "warning"
  | "error"
  | "neutral"
  | "loading";
export type YuzuToastNotice = {
  id: string;
  kind: ToastVariant;
  message: string;
  title?: string;
  duration?: number | null;
  progress?: number;
  icon?: "download" | "upload" | "copy" | "moon";
  action?: { label: string; onClick: () => void; altText?: string };
};
export type TransferNoticeHandler = (
  notice: YuzuToastNotice,
  start?: boolean,
) => void;
const variants = {
  info: { title: "Information", icon: Info },
  success: { title: "Success", icon: CheckCircle2 },
  warning: { title: "Warning", icon: TriangleAlert },
  error: { title: "Error", icon: CircleAlert },
  neutral: { title: "Notification", icon: Bell },
  loading: { title: "In progress", icon: LoaderCircle },
};
export function toastDuration(notice: YuzuToastNotice) {
  if (
    notice.duration === null ||
    (notice.kind === "loading" && notice.duration === undefined)
  )
    return Infinity;
  return Number.isFinite(notice.duration)
    ? Math.min(60000, Math.max(1000, notice.duration!))
    : 5000;
}
export function toastProgress(value: number) {
  return Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 0;
}
export function ToastVisual({
  notice,
  title,
  description,
  close,
  action,
}: {
  notice: YuzuToastNotice;
  title?: ReactNode;
  description?: ReactNode;
  close?: ReactNode;
  action?: ReactNode;
}) {
  const iconOverrides = {
    download: Download,
    upload: Upload,
    copy: Copy,
    moon: Moon,
  };
  const Icon = notice.icon
    ? iconOverrides[notice.icon]
    : variants[notice.kind].icon;
  const progress =
    notice.progress === undefined ? undefined : toastProgress(notice.progress);
  return (
    <>
      <span className="yuzu-toast-art" aria-hidden="true">
        <span className="yuzu-toast-lemon" />
      </span>
      <span className="yuzu-toast-leaf" aria-hidden="true" />
      <span
        className={`yuzu-toast-icon ${notice.kind === "loading" && !notice.icon ? "yuzu-toast-spinning" : ""}`}
        aria-hidden="true"
      >
        <Icon size={16} />
      </span>
      <div className="yuzu-toast-copy">
        {title ?? (
          <strong className="yuzu-toast-title">
            {notice.title ?? variants[notice.kind].title}
          </strong>
        )}
        {description ?? (
          <p className="yuzu-toast-description">{notice.message}</p>
        )}
        {progress !== undefined && (
          <div className="yuzu-toast-progress">
            <progress
              max={100}
              value={progress}
              aria-label={`${notice.title ?? variants[notice.kind].title} progress`}
            />
            <span>{Math.round(progress)}%</span>
          </div>
        )}
      </div>
      {(action || close) && (
        <div className="yuzu-toast-controls">
          {action}
          {close}
        </div>
      )}
    </>
  );
}
export function YuzuToast({ notice }: { notice: YuzuToastNotice | null }) {
  return (
    <Toast.Provider duration={5000} swipeDirection="right" label="Notification">
      {notice && (
        <Toast.Root
          key={notice.id}
          defaultOpen
          duration={toastDuration(notice)}
          data-slot="board-notification"
          data-variant={notice.kind}
          className="yuzu-toast"
          type={
            notice.kind === "error" || notice.kind === "warning"
              ? "foreground"
              : "background"
          }
        >
          <ToastVisual
            notice={notice}
            title={
              <Toast.Title className="yuzu-toast-title">
                {notice.title ?? variants[notice.kind].title}
              </Toast.Title>
            }
            description={
              <Toast.Description className="yuzu-toast-description">
                {notice.message}
              </Toast.Description>
            }
            action={
              notice.action && (
                <Toast.Action
                  asChild
                  altText={notice.action.altText ?? notice.action.label}
                >
                  <button
                    className="yuzu-toast-action"
                    onClick={notice.action.onClick}
                  >
                    {notice.action.label}
                  </button>
                </Toast.Action>
              )
            }
            close={
              <Toast.Close
                aria-label="Dismiss notification"
                className="yuzu-toast-close"
              >
                <X size={13} />
              </Toast.Close>
            }
          />
        </Toast.Root>
      )}
      <Toast.Viewport className="yuzu-toast-viewport" />
    </Toast.Provider>
  );
}
