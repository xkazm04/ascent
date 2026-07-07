"use client";

// Measured model-quality scorecard — surfaced in org LLM settings so an operator picks a BYOM /
// platform model on evidence, not vibes. Ranks the fleet on the one ascent LLM op (repo-maturity
// assess): judged output QUALITY, CALIBRATION accuracy against the labeled bench (does it land the
// right maturity level), RELIABILITY, and speed. Read-only projection of the baked matrix
// (src/lib/llm/matrix-scores.data). Renders nothing until a run has been baked in.

import { Card, SectionHeader } from "@/components/org/ui";
import { overallScore, rankModels, type ModelScore } from "@/lib/llm/matrix-scores";
import { MATRIX_SCORES, hasMatrixScores } from "@/lib/llm/matrix-scores.data";

const short = (slug: string) => slug.split("/").pop() ?? slug;
const pct = (n: number) => `${Math.round(n * 100)}%`;
const secs = (ms: number) => `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)}s`;
const LOW_RELIABILITY = 0.9;

// Overall 0–10 → a semantic bar tone (emerald good / amber ok / orange weak) on the dark surface.
const barTone = (s: number) =>
  s >= 7.5 ? "bg-emerald-400" : s >= 5.5 ? "bg-amber-400" : "bg-orange-400";

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

export function ModelScorecard() {
  if (!hasMatrixScores()) return null;
  const ranked = rankModels(MATRIX_SCORES);
  const best = ranked[0];
  const date = MATRIX_SCORES.measuredAt.slice(0, 10);

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
        {ranked.map((m) => (
          <Row key={m.model} m={m} best={best?.model === m.model} />
        ))}
      </div>
      <p className="mt-3 text-xs leading-relaxed text-slate-500">
        Measured {date} · judge {short(MATRIX_SCORES.judge)} · {MATRIX_SCORES.repos} labeled repos.
        Overall = 60% judged quality + 40% calibration, scaled by reliability. Small sample — directional,
        not a leaderboard to the decimal. Cost is not billed for these slugs; latency is the speed proxy.
      </p>
    </Card>
  );
}
