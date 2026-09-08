"use client";

// The (D) Disclosed target for a demoted A2 caveat: an ⓘ affordance holding ONE sentence.
//
// The redesign law says a load-bearing epistemic qualifier is never deleted — it moves into a visual
// state, an on-demand affordance, an empty state, or a feature doc. This is the affordance. It is a
// real <button> (not a hover-only tooltip), so the sentence is reachable by keyboard and by a screen
// reader: Escape closes, focus-visible paints the shared `.focus-ring`, and aria-expanded /
// aria-controls tie the trigger to the popover.

import { useId, useState } from "react";
import { STATE_HINT, type VizState } from "@/components/org/viz/states";

export function WhyChip({
  hint,
  state,
  label = "Why",
  align = "start",
  className = "",
}: {
  /** The one sentence. Omit to use the canonical caveat for `state`. */
  hint?: string;
  /** Pull the sentence from the shared vocabulary instead of re-typing it at the call site. */
  state?: VizState;
  /** Accessible name fragment — "Why: <label>". Keep it a noun phrase. */
  label?: string;
  align?: "start" | "end";
  className?: string;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const text = hint ?? (state ? STATE_HINT[state] : "");
  // Nothing to disclose → render nothing rather than an affordance that opens an empty box.
  if (text.length === 0) return null;

  return (
    <span
      className={`relative inline-flex ${className}`}
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          e.stopPropagation();
          setOpen(false);
        }
      }}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        aria-label={`Why: ${label}`}
        onClick={() => setOpen((v) => !v)}
        onBlur={(e) => {
          // Close when focus leaves the whole chip (trigger + popover), so a tab-away doesn't strand
          // an open popover over the next panel. relatedTarget is null on a click-out in some
          // browsers — treat that as "left".
          if (!e.currentTarget.parentElement?.contains(e.relatedTarget as Node | null)) setOpen(false);
        }}
        className={`focus-ring inline-flex h-4 w-4 items-center justify-center rounded-full border text-[10px] leading-none ${
          open ? "border-accent text-accent" : "border-divider text-slate-500 hover:text-slate-300"
        }`}
      >
        <span aria-hidden>i</span>
      </button>
      {open && (
        <span
          id={id}
          role="note"
          className={`absolute top-5 z-20 w-64 rounded-lg border border-divider bg-surface-strong/95 p-2.5 type-note text-slate-300 shadow-lg ${
            align === "end" ? "right-0" : "left-0"
          }`}
        >
          {text}
        </span>
      )}
    </span>
  );
}
