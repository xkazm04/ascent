"use client";

// Measured model-quality scorecard — surfaced in org LLM settings so an operator picks a BYOM /
// platform model on evidence, not vibes. Ranks the fleet on the one ascent LLM op (repo-maturity
// assess): judged output QUALITY, CALIBRATION accuracy against the labeled bench (does it land the
// right maturity level), RELIABILITY, and speed. Read-only projection of the baked matrix
// (src/lib/llm/matrix-scores.data). Renders nothing until a run has been baked in.

import { Card, SectionHeader } from "@/components/org/shared/ui";
import {
  ADAPTER_ARTIFACT_LABEL,
  isAdapterArtifact,
  isMatrixStale,
  matrixAgeDays,
  MATRIX_STALE_AFTER_DAYS,
  overallScore,
  rankModels,
  type ModelScore,
} from "@/lib/llm/matrix-scores";
import { MATRIX_SCORES, hasMatrixScores } from "@/lib/llm/matrix-scores.data";

const short = (slug: string) => slug.split("/").pop() ?? slug;
const pct = (n: number) => `${Math.round(n * 100)}%`;
const secs = (ms: number) => `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)}s`;
const LOW_RELIABILITY = 0.9;

// Overall 0–10 → a semantic bar tone (emerald good / amber ok / orange weak) on the dark surface.
const barTone = (s: number) =>
  s >= 7.5 ? "bg-emerald-400" : s >= 5.5 ? "bg-amber-400" : "bg-orange-400";

/**
 * A row whose zero is the DECODE ADAPTER's, not the model's: the run hit the output-token cap on every
 * attempt, so there is no verdict to report. Show that instead of "0.0 · ⚠ 0%", which reads as
 * "this flagship model scores zero" to the buyer choosing from this table.
 */
function ArtifactRow({ m }: { m: ModelScore }) {
  return (
    <div className="grid grid-cols-1 gap-2 border-b border-slate-800 px-1 py-3 last:border-0 sm:grid-cols-[1.5fr_1.7fr_0.9fr_0.9fr_0.7fr] sm:items-center sm:gap-3">
      <span className="text-sm font-medium text-slate-200" title={m.model}>
        {short(m.model)}
      </span>
      <span className="text-sm text-slate-400 sm:col-span-3">
        <span className="text-amber-300">{ADAPTER_ARTIFACT_LABEL}</span>{" "}
        <span className="text-slate-500">
          — output was truncated at the {m.outTok.toLocaleString()}-token cap on every attempt, so nothing was
          scored. See <span className="font-mono">docs/LLM_MODEL_MATRIX.md</span>.
        </span>
      </span>
      <span className="text-sm tabular-nums text-slate-400 sm:text-right" title="Median assess latency">
        {secs(m.p50Ms)}
      </span>
    </div>
  );
}

function Row({ m, best }: { m: ModelScore; best: boolean }) {
  const overall = overallScore(m);
  return (
    <div className="grid grid-cols-1 gap-2 border-b border-slate-800 px-1 py-3 last:border-0 sm:grid-cols-[1.5fr_1.7fr_0.9fr_0.9fr_0.7fr] sm:items-center sm:gap-3">
      <span className="text-sm font-medium text-slate-200" title={m.model}>
        {short(m.model)}
        {best ? <span className="ml-2 text-xs font-normal text-accent">★ top</span> : null}
        {m.reliability < LOW_RELIABILITY ? (
          <span
            className="ml-2 text-xs font-normal text-orange-300"
            title={`Produced a usable assessment on ${pct(m.reliability)} of repos; the rest errored or under-covered the rubric.`}
          >
            ⚠ {pct(m.reliability)}
          </span>
        ) : null}
      </span>
      <div className="flex items-center gap-2">
        <span className="w-8 text-sm font-semibold tabular-nums text-slate-100">{overall.toFixed(1)}</span>
        <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-800" aria-hidden>
          <span
            className={`block h-full rounded-full ${barTone(overall)}`}
            style={{ width: `${Math.round((overall / 10) * 100)}%` }}
          />
        </span>
      </div>
      <span className="text-sm tabular-nums text-slate-400 sm:text-right" title="LLM-as-judge output quality (1–10)">
        {m.quality.toFixed(1)} <span className="text-slate-600">qual</span>
      </span>
      <span
        className="text-sm tabular-nums text-slate-400 sm:text-right"
        title={`Calibration: ${pct(m.within1)} within one level, ${pct(m.exact)} exact (MAE ${m.mae.toFixed(1)})`}
      >
        {pct(m.within1)} <span className="text-slate-600">cal</span>
      </span>
      <span className="text-sm tabular-nums text-slate-400 sm:text-right" title="Median assess latency">
        {secs(m.p50Ms)}
      </span>
    </div>
  );
}

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
  const best = ranked.find((m) => !isAdapterArtifact(m));
  const date = MATRIX_SCORES.measuredAt.slice(0, 10);
  const stale = isMatrixStale(MATRIX_SCORES, at);
  const ageDays = matrixAgeDays(MATRIX_SCORES, at);

  return (
    <Card>
      <SectionHeader
        size="sm"
        title="Measured model quality"
        description="How each model performs on Ascent's repo-maturity assessment — judged output quality, calibration against the labeled benchmark, reliability, and speed. Use it to pick the model to connect above."
      />
      <div className="mt-4">
        <div className="hidden grid-cols-[1.5fr_1.7fr_0.9fr_0.9fr_0.7fr] gap-3 px-1 pb-2 text-xs font-semibold uppercase tracking-wide text-slate-500 sm:grid">
          <span>Model</span>
          <span>Overall</span>
          <span className="text-right">Quality</span>
          <span className="text-right">Calibration</span>
          <span className="text-right">Speed</span>
        </div>
        {ranked.map((m) =>
          isAdapterArtifact(m) ? (
            <ArtifactRow key={m.model} m={m} />
          ) : (
            <Row key={m.model} m={m} best={best?.model === m.model} />
          ),
        )}
      </div>
      {stale && (
        <p
          role="status"
          className="mt-3 rounded-lg border border-orange-500/30 bg-orange-500/5 p-3 text-xs leading-relaxed text-orange-200"
        >
          This benchmark is {ageDays} days old (over {MATRIX_STALE_AFTER_DAYS}). Model lineups turn over faster
          than that — treat it as a historical record and re-run the matrix before pinning a model.
        </p>
      )}
      <p className="mt-3 text-xs leading-relaxed text-slate-500">
        Measured {date} · judge {short(MATRIX_SCORES.judge)} · {MATRIX_SCORES.repos} labeled repos.
        Overall = 60% judged quality + 40% calibration, scaled by reliability. Small sample — directional,
        not a leaderboard to the decimal. Cost is not billed for these slugs; latency is the speed proxy.
        Rows marked <span className="text-amber-300">{ADAPTER_ARTIFACT_LABEL}</span> hit the harness&apos;s
        output-token cap and carry no verdict either way.
      </p>
    </Card>
  );
}
