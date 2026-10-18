"use client";
import Image from "next/image";
import {
  CircleAlert,
  Info,
  TriangleAlert,
  CheckCircle2,
  X,
} from "lucide-react";
import { YuzuMascot } from "@/components/yuzu/yuzu-mascot";
import { PauseLeaf, PauseSlice } from "./decor";

export type PauseIntent = "info" | "success" | "warning" | "danger";

const icons = {
  info: Info,
  success: CheckCircle2,
  warning: TriangleAlert,
  danger: CircleAlert,
};

/** The mascot's mood for each intent; the smiling logo is the happy yuzu. */
function Mood({ intent }: { intent: PauseIntent }) {
  if (intent === "info" || intent === "success")
    return (
      <Image
        src="/logo.svg"
        alt=""
        width={38}
        height={38}
        className="pause-alert-mascot"
      />
    );
  return (
    <span className="pause-alert-mascot" aria-hidden="true">
      <YuzuMascot mood={intent === "danger" ? "sad" : "confused"} />
    </span>
  );
}

/**
 * Inline banner that stays until dismissed or resolved. Titled alerts show
 * the mascot's mood and their own leaf; compact ones show a plain icon and
 * the corner leaf.
 */
export function PauseAlert({
  intent = "info",
  title,
  children,
  action,
  onDismiss,
  dismissLabel = "Dismiss",
  className = "",
}: {
  intent?: PauseIntent;
  title?: string;
  children: React.ReactNode;
  /** A link or button for the alert's next step. */
  action?: React.ReactNode;
  onDismiss?: () => void;
  dismissLabel?: string;
  className?: string;
}) {
  const Icon = icons[intent];
  return (
    <div
      role={intent === "danger" || intent === "warning" ? "alert" : "status"}
      className={`pause-alert ${className}`}
      data-intent={intent}
      data-compact={!title || undefined}
    >
      <PauseLeaf />
      <span className="pause-clip" aria-hidden="true">
        <PauseSlice />
      </span>
      {title ? (
        <Mood intent={intent} />
      ) : (
        <Icon size={16} className="pause-alert-icon" aria-hidden="true" />
      )}
      <div className="pause-alert-body">
        {title && <p className="pause-alert-title">{title}</p>}
        <div className="pause-alert-text">{children}</div>
        {action && <div className="pause-alert-action">{action}</div>}
      </div>
      {onDismiss && (
        <button
          type="button"
          className="pause-close"
          aria-label={dismissLabel}
          onClick={onDismiss}
        >
          <X size={15} />
        </button>
      )}
    </div>
  );
}
