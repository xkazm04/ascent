"use client";

import type { ReactNode, RefObject } from "react";

// The onboarding page provides the site chrome + width; the flow just renders its phase. The shared
// flow-root polite live region announces step transitions (ONB a11y #1) for every phase change —
// the prior per-step live region only covered scanning, leaving pick↔select moves silent.
export function Shell({
  children,
  flowRef,
  stepAnnounce,
}: {
  children: ReactNode;
  flowRef?: RefObject<HTMLDivElement | null>;
  stepAnnounce?: string;
}) {
  return (
    <div ref={flowRef}>
      <div role="status" aria-live="polite" className="sr-only">
        {stepAnnounce}
      </div>
      {children}
    </div>
  );
}
