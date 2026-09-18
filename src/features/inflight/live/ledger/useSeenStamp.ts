"use client";

// THE PRESENCE STAMP — advance the viewer's "since you last looked" anchor only after the ledger has
// been VISIBLE for SEEN_DWELL_MS continuous milliseconds, once per mount
// (`session-resume/last-seen-anchors`: an anchor claims the user SAW the state, so it may advance only
// when seeing was possible).
//
// A tab opened in the background, or hidden before the dwell elapses, never stamps: the timer starts
// on visible, is cleared the moment the tab hides, and re-checks visibility when it fires. The briefing
// itself is derived from the anchor SNAPSHOTTED at render (`loadLedger`), so this write — landing
// seconds later — can never erase the card it was stamped over. `enabled: false` (a briefing that could
// not be derived) stamps nothing: advancing past deltas the viewer never saw would lose them for good.

import { useEffect, useRef } from "react";
import { useIsVisible } from "../useIsVisible";
import { stampLiveSeen } from "./ledgerClient";

export const SEEN_DWELL_MS = 5_000;

export function useSeenStamp(slug: string, enabled: boolean, stamp: (slug: string) => Promise<unknown> = stampLiveSeen): void {
  const visible = useIsVisible();
  const stamped = useRef(false);

  useEffect(() => {
    if (!enabled || !visible || stamped.current) return;
    const timer = setTimeout(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      stamped.current = true;
      // A failed stamp is harmless — the anchor stays where it was, and the next visit re-reports.
      void stamp(slug).catch(() => undefined);
    }, SEEN_DWELL_MS);
    return () => clearTimeout(timer);
  }, [enabled, visible, slug, stamp]);
}
