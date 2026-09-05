// The Impact Ledger's cell vocabulary — the signed-number formatter, the em-dash delta cell, the
// score-ramp colours and the "Source" column's labels. Extracted from ImpactLedger.tsx to hold the
// 200-LOC cap under src/features (AGENTS.md); pure relocation, no behavior change. Server-safe:
// no hooks, no handlers, so no "use client".

/** Which surface produced the row — the "Source" column, whose cell was never emitted. Named in
 *  words rather than by the enum's id: "practice-pr" is a database value, not a reader's vocabulary. */
export const SOURCE_LABEL: Record<string, string> = { "practice-pr": "practice", loop: "loop lane" };
export const SOURCE_TITLE: Record<string, string> = {
  "practice-pr": "A starter PR opened from the Practice Library",
  loop: "A local improvement-loop lane",
};

export const GOOD = "#22c55e";
export const BAD = "#f97316";
export const MUTED = "#94a3b8";

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

