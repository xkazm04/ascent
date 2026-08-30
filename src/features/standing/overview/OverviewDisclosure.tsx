"use client";

// A progressive-disclosure section shared by the Overview prototype variants: the detail panels
// (full dimension ledger, cohort rollup, heatmap) sit ONE interaction below the headline instead of
// beside it at headline weight. The row itself is guidance — a label, and a one-line summary that
// says what is inside so the reader can decide whether to open it without opening it. The child is
// MOUNTED only while open (the heatmap and rollup hold their own state and are not cheap), and its
// entrance is the one motion this component owns — `.animate-fade-in` explains "expanded", and is
// gated under prefers-reduced-motion in globals.css.

import { useId, useState } from "react";

export function OverviewDisclosure({
  id,
  label,
  summary,
  defaultOpen = false,
  children,
}: {
  /** Scroll-anchor id (e.g. "heatmap" — the target of the ledger rows' ▦ links). */
  id?: string;
  label: string;
  /** What the panel holds, in numbers: "9 dimensions · 4 owe a follow-up". */
  summary?: string;
  /** Open on mount — and re-open when this flips true later (a `?dim=` deep link arriving). */
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();
  // A deep link (?dim=…#heatmap) can arrive on a soft navigation that keeps this component mounted;
  // the initial-state read above would miss it. Adjust state DURING render when the prop flips (the
  // React-documented "storing information from previous renders" pattern) — not in an effect, which
  // would paint the closed panel once before re-rendering it open.
  const [seenDefault, setSeenDefault] = useState(defaultOpen);
  if (defaultOpen !== seenDefault) {
    setSeenDefault(defaultOpen);
    if (defaultOpen) setOpen(true);
  }
  return (
    <section id={id} className={`border-t border-divider ${id ? "scroll-mt-[calc(var(--header-h)+2.5rem)]" : ""}`}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
        className="focus-ring flex w-full flex-wrap items-baseline justify-between gap-x-4 gap-y-1 rounded py-3 text-left"
      >
        <span className="flex items-baseline gap-3">
          <span aria-hidden className={`type-caption inline-block text-slate-500 motion-safe:transition-transform ${open ? "rotate-90" : ""}`}>
            ▸
          </span>
          <span className={`type-label tracking-[0.22em] ${open ? "text-white" : "text-slate-300"}`}>{label}</span>
        </span>
        {summary && <span className="type-caption tabular-nums text-slate-500">{summary}</span>}
      </button>
      {open && (
        <div id={panelId} className="animate-fade-in pb-5">
          {children}
        </div>
      )}
    </section>
  );
}
