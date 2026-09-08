"use client";

// Measured model-quality scorecard — surfaced in org LLM settings so an operator picks a BYOM /
// platform model on evidence, not vibes. Ranks the fleet on the one ascent LLM op (repo-maturity
// assess). Read-only projection of the baked matrix (src/lib/llm/matrix-scores.data). Renders nothing
// until a run has been baked in.
//
// The header used to name four axes and a decision in one sentence; it draws them now. See
// modelScorecardViz.ts for what each column means, why speed is not one of them, and for the
// never-benchmarked-vs-zero conflation the hatch closes.

import { Kicker } from "@/components/ui";
import { Card, SectionHeader } from "@/components/org/shared/ui";
import { Legend, MatrixGrid, WhyChip } from "@/components/org/viz";
import {
  isAdapterArtifact,
  isMatrixStale,
  matrixAgeDays,
  MATRIX_STALE_AFTER_DAYS,
  rankModels,
} from "@/lib/llm/matrix-scores";
import { MATRIX_SCORES, hasMatrixScores } from "@/lib/llm/matrix-scores.data";
import { ModelScorecardRows } from "./ModelScorecardRows";
import {
  SCORE_AXES,
  SCORE_AXIS_HINT,
  scorecardRows,
  scorecardScopeLine,
  scorecardStates,
  shortModel,
} from "./modelScorecardViz";

/** Wall clock, read through a module-level helper so the render body stays free of a direct impure
 *  call; tests inject `now` instead. The value only decides a >45-day staleness note, so an SSR/CSR
 *  millisecond difference can never flip what renders. */
const wallClockMs = () => Date.now();

/** `now` is injected (epoch ms) so the staleness note is deterministic in tests. */
export function ModelScorecard({ now }: { now?: number } = {}) {
  if (!hasMatrixScores()) return null;
  const at = now ?? wallClockMs();
  const ranked = rankModels(MATRIX_SCORES);
  // The top pin must be a real verdict — an artifact row already sorts last, but never let one win.
  const best = ranked.find((m) => !isAdapterArtifact(m)) ?? null;
  const rows = scorecardRows(ranked);
  const stale = isMatrixStale(MATRIX_SCORES, at);
  const ageDays = matrixAgeDays(MATRIX_SCORES, at);

  return (
    <Card>
      <SectionHeader size="sm" title="Measured model quality" description={scorecardScopeLine(MATRIX_SCORES)} />

      <div className="mt-4 max-w-sm">
        <MatrixGrid
          axes={[...SCORE_AXES]}
          rows={rows}
          title="Judged quality, benchmark calibration and reliability, per model, out of 100"
        />
      </div>

      <Legend states={scorecardStates(rows)} className="mt-3" />

      <ul className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
        {SCORE_AXES.map((axis) => (
          <li key={axis} className="flex items-center gap-1.5">
            <Kicker tone="muted" as="span">
              {axis}
            </Kicker>
            <WhyChip hint={SCORE_AXIS_HINT[axis]} label={axis} />
          </li>
        ))}
      </ul>

      <ModelScorecardRows ranked={ranked} best={best} />

      {stale && (
        <p
          role="status"
          className="mt-3 rounded-lg border border-orange-500/30 bg-orange-500/5 p-3 type-note leading-relaxed text-orange-200"
        >
          This benchmark is {ageDays} days old (over {MATRIX_STALE_AFTER_DAYS}). Model lineups turn over faster
          than that. Treat it as a historical record and re-run the matrix before pinning a model.
        </p>
      )}
      <p className="mt-3 type-note leading-relaxed text-slate-500">
        Judge {shortModel(MATRIX_SCORES.judge)} · overall = 60% judged quality + 40% calibration, scaled by
        reliability. Small sample: directional, not a leaderboard to the decimal. Cost is not billed for these
        slugs; latency is the speed proxy.
      </p>
    </Card>
  );
}
