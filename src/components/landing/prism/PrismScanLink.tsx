"use client";

// "Scan a repository", everywhere it appears. The link's href is the deep link (`?scan=1`), so it works
// before hydration and when opened in a new tab; on a plain click it instead presses the real ScanModal's
// own trigger (kept out of the layout), which opens and closes the dialog instantly with no navigation.
// Going through the URL would make Escape wait for a server round trip, because the deep link only closes
// once the page has re-rendered without `scan=1`.

import Link from "next/link";
import { createContext, useContext, type MouseEvent, type ReactNode } from "react";

/** Opens the scan dialog; false means it is not ready and the link should navigate as usual. */
const ScanContext = createContext<() => boolean>(() => false);

export const PrismScanProvider = ScanContext.Provider;

export function PrismScanLink({ href, className, children }: { href: string; className?: string; children: ReactNode }) {
  const openScan = useContext(ScanContext);
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    if (openScan()) e.preventDefault();
  };
  return (
    <Link className={className} href={href} scroll={false} onClick={onClick}>
      {children}
    </Link>
  );
}
