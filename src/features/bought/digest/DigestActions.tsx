// The week's "so what": three ranked moves, drawn by reach, with rank 1 given the accent block.
//
// Rank 1 is visually separated on purpose. A leadership update that lists three equally-weighted
// actions is a list nobody starts; the point of the ranking is that ONE of them is the next move.
// The rank-1 line is the same sentence the markdown export leads with, so the page and the pasted
// update cannot recommend different things — it is composed data from `@/lib/org/briefing`, not
// chrome, and it stays.
//
// What did NOT stay is the header's claim about the ranking, which was wrong (see DigestReachBars).
// The correct basis is disclosed on the header where a basis belongs, and ranks 2 and 3 are the
// chart's own rows: it carries their title, dimension, reach, level lift and projected points, which
// is strictly more than the one-line form it replaces.

import { Card, InlineEmpty, SectionHeader } from "@/components/org/shared/ui";
import { Kicker } from "@/components/ui";
import { Legend, WhyChip } from "@/components/org/viz";
import type { WeeklyDigest } from "@/lib/org/digest-types";
import { DigestReachBars } from "./DigestReachBars";
import { actionBars, presentStates } from "./digestViz";

const RANK_BASIS_HINT =
  "Ranked by reach × impact weight × dimension weight — not by the projected points. A moderate gap in ten " +
  "repositories can outrank a high-impact one in two, and the points beside each bar are a per-repository mean, " +
  "not a fleet total.";
const LIFT_HINT = "Repositories this move would carry over a maturity level edge, not just up in points.";

/** The rung at legend scale — the same accent edge the chart draws inside each bar. */
function LiftSwatch() {
  return (
    <svg viewBox="0 0 14 14" width={14} height={14} className="shrink-0" role="presentation" aria-hidden>
      <rect x={0} y={3} width={9} height={8} rx={2} fill="var(--color-accent)" fillOpacity={0.85} />
      <line x1={9} y1={1} x2={9} y2={13} stroke="var(--color-accent)" strokeWidth={1} />
      <rect x={9} y={3} width={5} height={8} rx={2} fill="var(--color-accent)" fillOpacity={0.3} />
    </svg>
  );
}

export function DigestActions({ actions }: { actions: WeeklyDigest["actions"] }) {
  const [first] = actions;
  if (!first) {
    return (
      <Card>
        <SectionHeader size="sm" title="Next three actions" />
        <InlineEmpty>No open gaps across the fleet&apos;s latest scans.</InlineEmpty>
      </Card>
    );
  }

  const { bars, maxRepos } = actionBars(actions);

  return (
    <Card>
      <SectionHeader
        size="sm"
        title="Next three actions"
        right={<WhyChip hint={RANK_BASIS_HINT} label="ranking basis" align="end" />}
      />
      <div className="mt-3">
        <DigestReachBars bars={bars} maxRepos={maxRepos} />
      </div>
      <Legend
        className="mt-3"
        states={presentStates(bars.map((b) => b.pointsState))}
        extra={[{ id: "lift", label: "advances a level", swatch: <LiftSwatch />, hint: LIFT_HINT }]}
      />
      <div className="mt-4 rounded-xl border border-accent/30 bg-accent/[0.06] px-4 py-3">
        <Kicker tone="accent">Recommended next move</Kicker>
        <p className="mt-1 type-body text-slate-200">{first.line}</p>
      </div>
    </Card>
  );
}
