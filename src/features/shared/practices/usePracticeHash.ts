"use client";

// The receiving end of the `/org/<slug>/practices#practice-<id>` deep link.
//
// FOUR surfaces route here — the executive briefing, plan initiatives, the overview's fix-first list
// and its posture dimensions — and after the ledger redesign dropped the old card anchor, every one
// of them landed at the top of an undifferentiated table. Restoring the anchor alone would only fix
// HALF the handoff: those links are sent by a surface that just told the lead "this is the cheapest
// gap to close", so the right destination is the APPLY flow, not a highlighted list row. This hook
// therefore scrolls the row into view AND opens its detail modal.
//
// (A fifth was governance's "cheapest path to green" chips — the original flagship
// governance→practice handoff. That card was deleted 2026-08-19; the contract below is unchanged.)
//
// Only MINED practices are addressable: every call site interpolates a catalogued practice id.

import { useEffect, useRef } from "react";
import type { PracticeRow } from "./practiceRows";

const PREFIX = "practice-";

/** The practice id encoded in a `#practice-<id>` hash, or null for any other hash. Pure. */
export function practiceIdFromHash(hash: string): string | null {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!raw.startsWith(PREFIX)) return null;
  const id = decodeURIComponent(raw.slice(PREFIX.length));
  return id.length > 0 ? id : null;
}

/**
 * Resolve the hash to a row, scroll to its anchor, and hand it to `onOpen`. Re-runs on `hashchange`
 * (a same-page link from another org tab changes only the hash, which fires no re-mount) and once the
 * rows are available. A hash is honored ONCE per value, so closing the modal doesn't immediately
 * re-open it while the hash is still in the URL.
 */
export function usePracticeHash(rows: PracticeRow[], onOpen: (row: PracticeRow) => void): void {
  const handled = useRef<string | null>(null);

  useEffect(() => {
    function apply() {
      const hash = window.location.hash;
      const id = practiceIdFromHash(hash);
      if (!id || handled.current === hash) return;
      const row = rows.find((r) => r.source === "mined" && r.id === id);
      if (!row) return; // an unknown/stale practice id leaves the page exactly as it was
      handled.current = hash;

      // Position the row first, then open the detail modal over it — so the row is already in place
      // when the modal is dismissed. Motion is gated (BRAND.md): honor prefers-reduced-motion.
      const el = document.getElementById(`${PREFIX}${id}`);
      const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
      el?.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "center" });
      onOpen(row);
    }

    // Re-running on a new `rows` identity is harmless and load-bearing: it resolves a hash that
    // arrived before the row it names existed. `handled` keeps it to one open per hash value.
    apply();
    window.addEventListener("hashchange", apply);
    return () => window.removeEventListener("hashchange", apply);
  }, [rows, onOpen]);
}
