"use client";

import { useRouter } from "next/navigation";
import { btnSecondary } from "./error-shell";

export function GoBackButton() {
  const router = useRouter();
  return (
    <button
      type="button"
      onClick={() => router.back()}
      className={btnSecondary}
    >
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
        <path d="M19 12H5" />
        <path d="M11 6l-6 6 6 6" />
      </svg>
      Go back
    </button>
  );
}
