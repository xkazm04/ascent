// One cross-team pairing, drawn as the gap it is.
//
// The pairings were a list of numbers with an arrow glyph between them — "Testing · platform 78 →
// mobile 41 · 37-pt gap" — which asks the reader to subtract, and gives no sense of WHERE on the
// 0..100 range the two teams sit. The same row as a track shows both at once: the distance between
// the marks IS the gap, and their absolute positions say whether this is a strong team pulling a
// weak one up or two mid teams a few points apart.
//
// Dependency-free SVG on `scoreHex` (never a hand-picked hex, §2.5). Server-safe: no hooks. The
// accessible name is generated from the same four numbers the geometry is, so it cannot drift.

import { r2 } from "@/components/org/viz";
import { scoreHex } from "@/lib/ui";
import type { TeamPairing } from "@/lib/db";

const W = 200;
const H = 18;
const PAD = 5;
const MID = H / 2;

const x = (score: number) => r2(PAD + (Math.max(0, Math.min(100, score)) / 100) * (W - PAD * 2));

export function TeamsPairingGap({ pairing }: { pairing: TeamPairing }) {
  const { mentorName, learnerName, mentorScore, learnerScore, gap, label } = pairing;
  const mx = x(mentorScore);
  const lx = x(learnerScore);
  const ariaLabel = `${label}: ${mentorName} at ${mentorScore}, ${learnerName} at ${learnerScore}, a ${gap}-point gap on a 0 to 100 scale.`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full max-w-[200px]" role="img" aria-label={ariaLabel}>
      <title>{ariaLabel}</title>
      {/* the full 0..100 range, so a 37-point gap between two low teams does not read like one
          between a low team and a high one */}
      <line x1={PAD} x2={W - PAD} y1={MID} y2={MID} stroke="var(--color-divider)" strokeWidth={1} />
      {/* the gap itself — the mark the arrow glyph was standing in for */}
      <line x1={Math.min(mx, lx)} x2={Math.max(mx, lx)} y1={MID} y2={MID} stroke="var(--color-accent)" strokeWidth={2} strokeOpacity={0.55} strokeLinecap="round" />
      <circle cx={lx} cy={MID} r={3.5} fill={scoreHex(learnerScore)} stroke="var(--color-surface-strong)" strokeWidth={1} />
      <circle cx={mx} cy={MID} r={3.5} fill={scoreHex(mentorScore)} stroke="var(--color-surface-strong)" strokeWidth={1} />
    </svg>
  );
}
