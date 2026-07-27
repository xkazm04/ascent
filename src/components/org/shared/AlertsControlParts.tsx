"use client";

// Extracted internals of AlertsControl (pure relocation to satisfy the 300-LOC rule):
// the focus-trap selector/helper and the regression-threshold fields.

import type * as React from "react";

// Tabbable elements inside the dialog — drives the focus trap + the "focus the first field on open".
export const FOCUSABLE_SELECTOR =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

// Keep Tab/Shift+Tab inside the dialog while it's open (cycle at the edges).
export function trapTab(e: React.KeyboardEvent<HTMLDivElement>, dialog: HTMLDivElement | null) {
  if (e.key !== "Tab" || !dialog) return;
  const focusables = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
  if (focusables.length === 0) {
    e.preventDefault();
    return;
  }
  const firstEl = focusables[0]!;
  const lastEl = focusables[focusables.length - 1]!;
  const active = document.activeElement;
  if (e.shiftKey) {
    if (active === firstEl || active === dialog) {
      e.preventDefault();
      lastEl.focus();
    }
  } else if (active === lastEl) {
    e.preventDefault();
    firstEl.focus();
  }
}

export function ThresholdFields({
  overallDrop,
  dimensionDrop,
  setOverallDrop,
  setDimensionDrop,
}: {
  overallDrop: string;
  dimensionDrop: string;
  setOverallDrop: (v: string) => void;
  setDimensionDrop: (v: string) => void;
}) {
  return (
    <>
      {/* Scope the copy honestly: these thresholds tune the PER-REPO regression alerts only
          (scan-alerts.ts). The weekly digest's "Regressions:" list is gated by the global
          noise band, a deliberate split documented in the digest route — without this line an
          admin reasonably concludes the fields tune the digest too, changes them, and watches
          "nothing happen". (ambiguity-ui 2026-07-16 #2) */}
      <div className="mt-3 text-sm text-slate-400">
        Regression sensitivity (points) — applies to per-repo regression alerts; blank inherits the default.
        The weekly digest keeps its own fleet-wide noise band.
      </div>
      <div className="mt-1.5 flex flex-wrap gap-3">
        <label className="flex items-center gap-1.5 font-mono text-sm text-slate-500">
          overall drop
          <input
            type="number"
            min={1}
            max={100}
            value={overallDrop}
            onChange={(e) => setOverallDrop(e.target.value)}
            placeholder="5"
            className="w-16 rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-sm text-slate-200 outline-none focus:border-accent"
          />
        </label>
        <label className="flex items-center gap-1.5 font-mono text-sm text-slate-500">
          dimension drop
          <input
            type="number"
            min={1}
            max={100}
            value={dimensionDrop}
            onChange={(e) => setDimensionDrop(e.target.value)}
            placeholder="15"
            className="w-16 rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-sm text-slate-200 outline-none focus:border-accent"
          />
        </label>
      </div>
    </>
  );
}
