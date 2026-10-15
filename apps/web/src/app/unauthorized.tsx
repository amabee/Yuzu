import Link from "next/link";
import {
  ErrorShell,
  btnPrimary,
  btnSecondary,
} from "@/components/yuzu/error-shell";

// Triggered by unauthorized() from "next/navigation" (needs experimental.authInterrupts).
export default function Unauthorized() {
  return (
    <ErrorShell
      mood="sleepy"
      code="Error 401"
      title="Your session expired"
      description="Your session is no longer valid. Sign back in to pick up where you left off."
    >
      <Link href="/sign-in" className={btnPrimary}>
        Sign in again
      </Link>
      <Link href="/" className={btnSecondary}>
        Back to home
      </Link>
    </ErrorShell>
  );
}
