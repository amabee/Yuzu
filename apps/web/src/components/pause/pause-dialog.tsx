"use client";
import { Dialog as DialogPrimitive } from "radix-ui";
import {
  Check,
  CircleAlert,
  Info,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";
import { PauseLeaf, PauseSlice } from "./decor";
import type { PauseIntent } from "./pause-alert";

const icons = {
  info: Info,
  success: Check,
  warning: TriangleAlert,
  danger: Trash2,
};

/** Shared overlay, motion, focus and dismissal rules for dialogs and modals. */
function PausePortal({
  kind,
  intent,
  destructive,
  className,
  children,
}: {
  kind: "dialog" | "modal";
  intent: PauseIntent | "yuzu";
  destructive?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="pause-backdrop" />
      <DialogPrimitive.Content
        className={`pause-surface ${className ?? ""}`}
        data-kind={kind}
        data-intent={intent}
        // Destructive dialogs only close through an explicit choice.
        onInteractOutside={(event) => {
          if (destructive) event.preventDefault();
        }}
        // Start on the element marked for it (an input, or the primary
        // action so Enter confirms); otherwise Radix picks the first.
        onOpenAutoFocus={(event) => {
          const target = (
            event.currentTarget as HTMLElement | null
          )?.querySelector<HTMLElement>("[data-autofocus]");
          if (target) {
            event.preventDefault();
            target.focus();
          }
        }}
      >
        <PauseLeaf />
        <span className="pause-clip" aria-hidden="true">
          <PauseSlice />
        </span>
        {children}
        <DialogPrimitive.Close className="pause-close" aria-label="Close">
          <X size={16} />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

/**
 * A short, single-decision pause: 440px, tinted by intent. Use `result` for a
 * centered outcome (such as success) with stacked actions.
 */
export function PauseDialog({
  open,
  onOpenChange,
  intent = "info",
  title,
  description,
  children,
  actions,
  result = false,
  destructive = intent === "danger",
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  intent?: PauseIntent;
  title: string;
  description?: React.ReactNode;
  /** Extra content, such as a type-to-confirm field or an error. */
  children?: React.ReactNode;
  /** Buttons, secondary first; mark the confirming one with data-autofocus. */
  actions: React.ReactNode;
  result?: boolean;
  destructive?: boolean;
}) {
  const Icon =
    intent === "danger" ? (result ? CircleAlert : icons.danger) : icons[intent];
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <PausePortal
        kind="dialog"
        intent={intent}
        destructive={destructive}
        className={result ? "pause-result" : undefined}
      >
        <div className="pause-dialog-head">
          <span className="pause-icon" aria-hidden="true">
            <Icon size={result ? 22 : 17} />
          </span>
          <div className="min-w-0">
            <DialogPrimitive.Title className="pause-title">
              {title}
            </DialogPrimitive.Title>
            {description ? (
              <DialogPrimitive.Description className="pause-description">
                {description}
              </DialogPrimitive.Description>
            ) : (
              <DialogPrimitive.Description className="sr-only">
                {title}
              </DialogPrimitive.Description>
            )}
          </div>
        </div>
        {children && <div className="pause-dialog-body">{children}</div>}
        <div className="pause-actions">{actions}</div>
      </PausePortal>
    </DialogPrimitive.Root>
  );
}

/** A bigger task that needs its own space: 560px with a warm yuzu wash. */
export function PauseModal({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  actions,
  as = "div",
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  /** A short note on the left of the footer. */
  footer?: React.ReactNode;
  actions: React.ReactNode;
  /** Render the body as a form so Enter submits it. */
  as?: "div" | "form";
  onSubmit?: (event: React.FormEvent<HTMLFormElement>) => void;
}) {
  const content = (
    <>
      <div className="pause-modal-head">
        <DialogPrimitive.Title className="pause-title">
          {title}
        </DialogPrimitive.Title>
        {description ? (
          <DialogPrimitive.Description className="pause-description">
            {description}
          </DialogPrimitive.Description>
        ) : (
          <DialogPrimitive.Description className="sr-only">
            {title}
          </DialogPrimitive.Description>
        )}
      </div>
      <div className="pause-modal-body">{children}</div>
      <div className="pause-modal-foot">
        <span className="pause-modal-note">{footer}</span>
        <div className="pause-actions">{actions}</div>
      </div>
    </>
  );
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <PausePortal kind="modal" intent="yuzu">
        {as === "form" ? (
          <form className="pause-modal-form" onSubmit={onSubmit}>
            {content}
          </form>
        ) : (
          <div className="pause-modal-form">{content}</div>
        )}
      </PausePortal>
    </DialogPrimitive.Root>
  );
}

export const PauseClose = DialogPrimitive.Close;

/**
 * Buttons inside pause points. "primary" takes the surface's intent color
 * (blue for info, red for danger, yuzu for warnings and modals, green for
 * success); "quiet" is the outlined secondary; "text" is a bare choice such
 * as Discard.
 */
export function PauseButton({
  tone = "quiet",
  className = "",
  ...props
}: React.ComponentProps<"button"> & { tone?: "primary" | "quiet" | "text" }) {
  return (
    <button
      type="button"
      {...props}
      className={`pause-button ${className}`}
      data-tone={tone}
    />
  );
}
