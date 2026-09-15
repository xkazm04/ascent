"use client";

// The ranked index under the scorecard matrix — the row-level evidence the matrix cannot carry, plus
// the affordance that replaces a navigation sentence.
//
// "Use it to pick the model to connect above" was a hint pointing at a control the reader then had to
// find, and a model slug they then had to retype from a truncated matrix label. That is an AFFORDANCE
// problem, not a copy problem (Wave 2's PracticesView result): each row now carries the FULL slug and
// a "Use ↑" link that copies it and jumps to the OpenRouter card, whose anchor SettingsTab owns.
// These are OpenRouter slugs — matrix-scores.ts says so — so the OpenRouter card is the right target.
//
// Latency lives here rather than in the matrix on purpose: it is a duration, and MatrixGrid paints a
// printed score on the maturity ramp. See modelScorecardViz.ts.

import { ADAPTER_ARTIFACT_LABEL, isAdapterArtifact, overallScore, type ModelScore } from "@/lib/llm/matrix-scores";
import { BYOM_ANCHOR, latencyLabel, shortModel } from "./modelScorecardViz";

const ROW = "grid grid-cols-1 gap-x-3 gap-y-1 border-b border-slate-800 px-1 py-2.5 last:border-0 sm:grid-cols-[1.4fr_2.2fr_0.6fr_0.6fr] sm:items-baseline";

/** Copying is a convenience, never the mechanism — a browser that refuses still gets the jump. */
function copySlug(slug: string): void {
  try {
    const p = navigator.clipboard?.writeText(slug);
    if (p) void p.catch(() => {});
  } catch {
    /* no clipboard access on this surface */
  }
}

export function ModelScorecardRows({ ranked, best }: { ranked: ModelScore[]; best: ModelScore | null }) {
  return (
    <ul className="mt-4">
      {ranked.map((m) => {
        const artifact = isAdapterArtifact(m);
        return (
          <li key={m.model} className={ROW}>
            <span className="type-body-sm font-medium text-slate-200">
              <span className="font-mono text-slate-300">{shortModel(m.model)}</span>
              {best?.model === m.model ? <span className="ml-2 type-note font-normal text-accent">★ top</span> : null}
            </span>

            {artifact ? (
              <span className="type-body-sm text-slate-400">
                <span className="text-amber-300">{ADAPTER_ARTIFACT_LABEL}</span>
                <span className="text-slate-500">
                  : output was truncated at the {m.outTok.toLocaleString()}-token cap on every attempt, so nothing
                  was scored. See <span className="font-mono">docs/features/scanning/llm-model-matrix.md</span>.
                </span>
              </span>
            ) : (
              <span className="type-mono-sm text-slate-500" title={m.model}>
                {m.model} <span className="text-slate-300">· overall {overallScore(m).toFixed(1)}</span>
              </span>
            )}

            <span className="type-body-sm tabular-nums text-slate-400 sm:text-right" title="Median assess latency">
              {latencyLabel(m.p50Ms)}
            </span>

            {artifact ? (
              <span className="sm:text-right" />
            ) : (
              <a
                href={`#${BYOM_ANCHOR}`}
                onClick={() => copySlug(m.model)}
                title={`Copy ${m.model} and jump to the OpenRouter card`}
                className="focus-ring type-mono-sm text-slate-400 transition hover:text-accent sm:text-right"
              >
                Use ↑
              </a>
            )}
          </li>
        );
      })}
    </ul>
  );
}
