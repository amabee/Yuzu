"use client";

// Replaces the root layout when it crashes, so it must render <html> and <body>
// and cannot rely on your providers or Tailwind classes loaded in the layout.
import "./globals.css";
import { ErrorShell, btnPrimary } from "@/components/yuzu/error-shell";

export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <html lang="en">
      <body>
        <ErrorShell
          mood="sad"
          code="Error 500"
          title="Something went wrong"
          description="Yuzu hit a serious snag. Please try again."
          footer={
            error.digest && (
              <p className="mt-4 font-mono text-sm">{error.digest}</p>
            )
          }
        >
          <button type="button" onClick={retry} className={btnPrimary}>
            Try again
          </button>
        </ErrorShell>
      </body>
    </html>
  );
}
