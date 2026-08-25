"use client";

// WAITING, HONESTLY. Every line here is driven by a real `phase` / `tool` event off the wire — there
// is no fake progress and no invented stage. The three phases are the ones the turn actually has, and
// a tool line names the tool she is actually calling.
//
// THE SECOND LINE AFTER 8 SECONDS names the ACTUAL wait rather than apologising. A spinner that has
// been turning for ten seconds tells the operator nothing they cannot already see; "the whole reply
// arrives at once" tells them why nothing has appeared yet and that nothing is stuck.
//
// NO ALWAYS-ON MOTION LOOP. The pulse exists only while a turn is in flight — it is not chrome that
// breathes at an idle drawer — and it is `motion-safe:` gated exactly as `HighlightLayer.tsx:15` is,
// so a reduced-motion reader gets the same words with a still dot.
//
// aria-hidden on purpose: these are BEATS. The panel announces at the level of "a decision is
// waiting", once, when the turn settles — narrating every phase to a screen reader would be three
// interruptions per answer.

import { useEffect, useState } from "react";
import type { AthenaPhase } from "@/lib/athena/turn";

/** How long a wait runs before it is worth explaining. */
export const ATHENA_SLOW_WAIT_MS = 8_000;

const PHASE_LINE: Record<AthenaPhase, string> = {
  recalling: "Looking through what she remembers",
  grounding: "Checking what she's allowed to read",
  thinking: "Working out the answer",
};

export function AthenaWaiting({
  phase,
  tool,
  since,
}: {
  phase: AthenaPhase | null;
  tool: string | null;
  /** Epoch ms the wait began, or null when nothing is in flight. */
  since: number | null;
}) {
  const [slow, setSlow] = useState(false);
  // Reset DURING render, not in the effect — the idiomatic React "adjust state when a prop changes"
  // pattern, the same one `useChartHover` (chartHover.tsx:68) uses. Resetting inside the effect would
  // paint one frame of the PREVIOUS turn's "still going" line above a wait that just started.
  const [seen, setSeen] = useState(since);
  if (seen !== since) {
    setSeen(since);
    setSlow(false);
  }
  useEffect(() => {
    if (since === null) return;
    const id = window.setTimeout(() => setSlow(true), ATHENA_SLOW_WAIT_MS);
    return () => window.clearTimeout(id);
  }, [since]);

  if (since === null) return null;
  const line = tool ? `Reading the fleet · ${tool}` : PHASE_LINE[phase ?? "recalling"];
  return (
    <div aria-hidden className="border-l-2 border-slate-800 pl-3">
      <div className="flex items-center gap-2">
        <span className="h-1.5 w-1.5 rounded-full bg-accent motion-safe:animate-pulse" />
        <span className="font-mono text-xs uppercase tracking-[0.2em] text-slate-500">{line}</span>
      </div>
      {slow && (
        <p className="mt-1.5 text-xs leading-relaxed text-slate-600">
          Still going. Her whole reply arrives at once rather than a word at a time, so nothing shows up
          until she has finished — a grounded answer runs several reads against this org first.
        </p>
      )}
    </div>
  );
}
