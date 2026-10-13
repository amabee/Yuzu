"use client";

import Link, { useLinkStatus } from "next/link";

/** The welcome page's one call to action. Opens the installation setup. */
export function GetStartedButton() {
  return (
    <Link className="go-btn" id="getStarted" href="/setup">
      Get Started
      <Progress />
    </Link>
  );
}

function Progress() {
  const { pending } = useLinkStatus();
  return (
    <>
      <span className={`go-ic${pending ? " pending" : ""}`} aria-hidden="true">
        <svg className="arrow" viewBox="0 0 24 24">
          <path d="M5 12h14M13 6l6 6-6 6" />
        </svg>
        <svg className="spin" viewBox="0 0 24 24">
          <path d="M21 12a9 9 0 1 1-6.2-8.6" />
        </svg>
      </span>
      <span className="sr-only" aria-live="polite">
        {pending ? "Opening setup" : ""}
      </span>
    </>
  );
}
