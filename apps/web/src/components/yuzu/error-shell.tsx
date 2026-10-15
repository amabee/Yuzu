import type { ReactNode } from "react";
import { YuzuMascot, type YuzuMood } from "./yuzu-mascot";

type Props = {
  mood: YuzuMood;
  code?: string;
  title: string;
  description: string;
  hero?: ReactNode; // replaces the default mascot (used by the 404 "4 🍋 4")
  children?: ReactNode; // action buttons
  footer?: ReactNode;
};

const focus =
  "focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-[3px] focus-visible:outline-[#FB9A12]";
export const btnPrimary = `inline-flex min-h-12 items-center gap-2 rounded-full bg-primary px-6 font-semibold text-primary-foreground shadow-lg transition hover:-translate-y-0.5 ${focus}`;
export const btnSecondary = `inline-flex min-h-12 items-center gap-2 rounded-full border-[1.5px] border-border bg-card px-6 font-semibold text-foreground transition hover:-translate-y-0.5 ${focus}`;

export function ErrorShell({
  mood,
  code,
  title,
  description,
  hero,
  children,
  footer,
}: Props) {
  return (
    <div
      className="yuzu-error-shell relative flex flex-col overflow-hidden text-foreground"
      style={{ fontFamily: "var(--font-body, inherit)" }}
    >
      {/* soft glow behind the mascot */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-[34%] h-[900px] max-h-[68%] w-[900px] max-w-full -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{
          background:
            "radial-gradient(closest-side, rgba(255,216,58,.30), transparent)",
        }}
      />

      <main className="relative flex flex-1 flex-col items-center justify-center gap-[18px] px-4 pb-16 pt-4 text-center bg-transparent">
        {hero ?? (
          <div className="text-primary">
            <YuzuMascot mood={mood} />
          </div>
        )}
        {code && (
          <p className="inline-flex rounded-full bg-muted px-3 py-1.5 font-mono text-[12.5px] font-medium uppercase tracking-[.08em] text-muted-foreground">
            {code}
          </p>
        )}
        <h1
          className="text-[clamp(32px,5vw,56px)] font-extrabold leading-[1.05] tracking-[-.025em]"
          style={{ fontFamily: "var(--font-display, inherit)" }}
        >
          {title}
        </h1>
        <p className="max-w-[480px] text-[17px] leading-relaxed text-muted-foreground">
          {description}
        </p>
        <div className="mt-2.5 flex flex-wrap justify-center gap-3">
          {children}
        </div>
        {footer}
      </main>
    </div>
  );
}
