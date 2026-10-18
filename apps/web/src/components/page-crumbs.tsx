"use client";
import { Fragment, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { ChevronRight } from "lucide-react";

export const CRUMBS_SLOT = "page-crumbs";
const subscribe = () => () => {};

/** A page's breadcrumb, shown in the shell's top bar. Pages declare it where
 *  they render; it moves into the top bar once the page has hydrated. */
export function PageCrumbs({
  items,
}: {
  items: { label: React.ReactNode; href?: string }[];
}) {
  const mounted = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  const slot = mounted ? document.getElementById(CRUMBS_SLOT) : null;
  if (!slot) return null;
  return createPortal(
    <nav aria-label="Breadcrumb" className="page-crumbs">
      {items.map((item, index) => {
        const last = index === items.length - 1;
        return (
          <Fragment key={index}>
            {index > 0 && <ChevronRight size={14} aria-hidden="true" />}
            {item.href && !last ? (
              <Link href={item.href}>{item.label}</Link>
            ) : (
              <span aria-current={last ? "page" : undefined}>{item.label}</span>
            )}
          </Fragment>
        );
      })}
    </nav>,
    slot,
  );
}
