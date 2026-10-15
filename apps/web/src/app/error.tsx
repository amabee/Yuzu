"use client";

import Link from "next/link";
import { useEffect } from "react";
import {
  ErrorShell,
  btnPrimary,
  btnSecondary,
} from "@/components/yuzu/error-shell";

export default function Error({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <ErrorShell
      mood="sad"
      code="Error 500"
      title="Something went wrong"
      description="Yuzu hit an unexpected snag on our end. Your work is safe. Give it another try, and if it keeps happening, let us know."
      footer={
        error.digest && (
          <p className="mt-4 text-sm text-muted-foreground">
            Error ID{" "}
            <code className="font-mono text-foreground">{error.digest}</code>
          </p>
        )
      }
    >
      <button type="button" onClick={retry} className={btnPrimary}>
        Try again
      </button>
      <Link href="/" className={btnSecondary}>
        Back to home
      </Link>
    </ErrorShell>
  );
}
