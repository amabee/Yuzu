import Link from "next/link";
import {
  ErrorShell,
  btnPrimary,
  btnSecondary,
} from "@/components/yuzu/error-shell";

// Triggered by forbidden() from "next/navigation".
// Needs `experimental: { authInterrupts: true }` in next.config.
export default function Forbidden() {
  return (
    <ErrorShell
      mood="stern"
      code="Error 403"
      title="You don't have access"
      description="This page is limited to certain members of the workspace. Ask an admin to give you access, or switch to an account that has it."
    >
      <Link href="/" className={btnPrimary}>
        Back to home
      </Link>
      <Link href="/boards" className={btnSecondary}>
        My boards
      </Link>
    </ErrorShell>
  );
}
