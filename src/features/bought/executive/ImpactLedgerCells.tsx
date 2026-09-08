// The Impact Ledger's cell vocabulary — the signed-number formatter, the em-dash delta cell, the
// score-ramp colours and the "Source" column's labels. Extracted from ImpactLedger.tsx to hold the
// 200-LOC cap under src/features (AGENTS.md); pure relocation, no behavior change. Server-safe:
// no hooks, no handlers, so no "use client".

import { DIRECTION_TONE } from "@/components/ui";
import { LEVEL_HEX } from "@/lib/ui";

/** Which surface produced the row — the "Source" column, whose cell was never emitted. Named in
 *  words rather than by the enum's id: "practice-pr" is a database value, not a reader's vocabulary. */
export const SOURCE_LABEL: Record<string, string> = { "practice-pr": "practice", loop: "loop lane" };
export const SOURCE_TITLE: Record<string, string> = {
  "practice-pr": "A starter PR opened from the Practice Library",
  loop: "A local improvement-loop lane",
};

// The /org redesign forbids a hand-picked hex (docs/ORG-UX-REDESIGN.md §2.5): these three are the
// same values they always were, now read from their canonical homes — the maturity ramp and the
// direction-tone triad — so a rebrand of either lands here without a hunt.
export const GOOD = LEVEL_HEX.L5;
export const BAD = DIRECTION_TONE.falling.color;
export const MUTED = DIRECTION_TONE.flat.color;

/** Signed points, always with an explicit sign so a negative can't be misread as a magnitude. */
export function signed(n: number): string {
  return n > 0 ? `+${n}` : String(n);
}

export function deltaCell(value: number | null, unmeasuredTitle: string) {
  if (value == null) {
    return (
      <span className="font-mono tabular-nums text-slate-500" title={unmeasuredTitle}>
        —
      </span>
    );
  }
  return (
    <span className="font-mono tabular-nums" style={{ color: value > 0 ? GOOD : value < 0 ? BAD : MUTED }}>
      {signed(value)}
    </span>
  );
}

