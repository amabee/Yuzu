import Link from "next/link";
import { ErrorShell, btnPrimary } from "@/components/yuzu/error-shell";
import { GoBackButton } from "@/components/yuzu/go-back";
import { YuzuMascot } from "@/components/yuzu/yuzu-mascot";

const quick = [
  { href: "/projects", label: "Projects" },
  { href: "/boards", label: "My boards" },
  { href: "/docs", label: "Documentation" },
];

export default function NotFound() {
  return (
    <ErrorShell
      mood="confused"
      code="Error 404"
      title="Hmm, we can't find that page"
      description="The link may be broken, or the page may have moved or been deleted. Yuzu looked everywhere and is a little confused too."
      hero={
        <div
          role="img"
          aria-label="404, with the Yuzu mascot looking confused as the zero"
          className="flex items-end justify-center font-extrabold leading-[.85] tracking-[-.04em] text-foreground"
          style={{
            fontSize: "clamp(110px, 21vw, 250px)",
            fontFamily: "var(--font-display, inherit)",
          }}
        >
          <span aria-hidden>4</span>
          <span
            className="text-primary"
            style={{ width: ".98em", height: "1.1em", margin: "0 -.02em" }}
          >
            <YuzuMascot
              mood="confused"
              style={{ width: "100%", height: "100%" }}
            />
          </span>
          <span aria-hidden>4</span>
        </div>
      }
      footer={
        <div className="mt-5 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-sm text-muted-foreground">
          <span>Or jump to</span>
          {quick.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="font-semibold text-foreground hover:underline"
            >
              {l.label}
            </Link>
          ))}
        </div>
      }
    >
      <Link href="/" className={btnPrimary}>
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M3 11l9-8 9 8" />
          <path d="M5 10v10h5v-6h4v6h5V10" />
        </svg>
        Back to home
      </Link>
      <GoBackButton />
    </ErrorShell>
  );
}
