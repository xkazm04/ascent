// Adoption → outcome strip for one skill (src/lib/org/skill-outcomes.ts): for every repo that adopted
// this skill, the overall-score movement between the last scan BEFORE adoption and the latest scan since.
//
// AN OUTCOME IS A CLAIM ABOUT A WINDOW, NOT A VERIFIED FACT, and it now says so in the paint rather
// than in a sentence under forty rows. The sibling Memory tab draws the same distinction, so the two
// Shared-group tabs speak one vocabulary: a pair that exists and agrees on its instrument is
// `measured`; a pair with a missing side is `missing` — a void, never a zero delta; a pair that
// exists but straddles two rubric versions is `not-judged` — hatched, and `rendersValue` is false for
// that state, so the row STRUCTURALLY cannot print a number nobody may compare.
//
// The mean now ships with the population it excluded (`meanDeltaLine`), which is the point where
// selection bias would otherwise enter silently: 2 of 4 adoptions measured is a different claim from
// 4 of 4, and the module has always refused to let one be published without the other.
//
// AND THE DISTANCE TRAVELS WITH THE NUMBER: `withinPairingBound` (PAIRING_MAX_DISTANCE_DAYS, 180)
// flags rather than filters, and a flag no consumer renders flags nothing.

import { StateSwatch, WhyChip, rendersValue } from "@/components/org/viz";
import { OUTCOME_VIZ_STATE } from "@/features/shared/skills/skillLifecycleViz";
import {
  PAIRING_MAX_DISTANCE_DAYS,
  aggregateOutcomes,
  meanDeltaLine,
  outcomeStatusLabel,
  type SkillOutcome,
} from "@/lib/org/skill-outcomes";

const CORRELATION_HINT =
  "Movement in the same window as the adoption: correlation, not proof of cause. Other work lands in the same window, and nothing here isolates the skill's contribution.";

const ANCHOR_HINT: Record<SkillOutcome["anchor"], string> = {
  adoption: "Anchored at the adoption a person recorded for this repo.",
  "first-invoke": "No adoption was recorded for this repo; anchored at its first reported invocation — a machine's observation, weaker provenance than a person's record.",
};

const fmtDelta = (d: number) => `${d > 0 ? "+" : ""}${d}`;

function DeltaRow({ o }: { o: SkillOutcome }) {
  const state = OUTCOME_VIZ_STATE[o.status];
  const measured = state === "measured" && o.overallDelta !== null && rendersValue(state);
  const delta = o.overallDelta ?? 0;
  const tone = delta > 0 ? "text-emerald-300" : delta < 0 ? "text-orange-300" : "text-slate-400";
  const top = o.dimensionDeltas.find((d) => d.delta !== 0);
  return (
    <li className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
      <span className="self-center">
        <StateSwatch state={state} size={10} />
      </span>
      <span className="font-mono text-slate-300" title={ANCHOR_HINT[o.anchor]}>
        {o.repoFullName.split("/").pop()}
      </span>
      {measured ? (
        <>
          <span className={`font-mono tabular-nums ${tone}`} title={`${o.before!.overallScore} → ${o.after!.overallScore} overall`}>
            {fmtDelta(delta)} overall
          </span>
          <span className="text-slate-500">
            since adoption ({o.before!.scannedAt.slice(0, 10)} → {o.after!.scannedAt.slice(0, 10)})
          </span>
          {top && (
            <span className="font-mono text-slate-500" title="Largest per-dimension move in the same window">
              · {top.dimId} {fmtDelta(top.delta)}
            </span>
          )}
          {o.withinPairingBound === false && (
            <span
              className="type-caption text-amber-300/90"
              title={`One side of this pair is more than ${PAIRING_MAX_DISTANCE_DAYS} days from the adoption (${o.beforeGapDays ?? "?"}d before, ${o.afterGapDays ?? "?"}d after). The scans are far enough apart that other work dominates the window.`}
            >
              · wide window
            </span>
          )}
        </>
      ) : (
        // Unmeasurable adoptions are shown, not hidden: "no scan since adoption yet" tells the org to
        // re-scan, whereas a silently omitted row reads as "no effect".
        <span className="text-slate-500">{outcomeStatusLabel(o.status)}</span>
      )}
    </li>
  );
}

export function SkillOutcomes({ outcomes }: { outcomes: SkillOutcome[] | undefined }) {
  if (!outcomes || outcomes.length === 0) return null;
  const agg = aggregateOutcomes(outcomes);
  return (
    <div className="mt-3 border-t border-slate-800 pt-3">
      <p className="type-label tracking-widest text-slate-500">Score movement since adoption</p>
      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
        <StateSwatch state={agg.meanDelta === null ? "not-judged" : "measured"} size={11} />
        <span className="font-mono tabular-nums text-slate-300">{meanDeltaLine(agg)}</span>
        <WhyChip hint={CORRELATION_HINT} label="score movement since adoption" />
      </div>
      <ul className="mt-1.5 space-y-1 type-body-sm">
        {outcomes.map((o) => (
          <DeltaRow key={`${o.repoFullName}-${o.adoptedAt}`} o={o} />
        ))}
      </ul>
    </div>
  );
}
