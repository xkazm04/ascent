"use client";

// The per-dimension detail body — summary, evidence, gaps, trend sparkline, and the score-provenance
// micro-viz. Extracted from the old DimensionCard so the new Dimensions explorer (radar + bars + this
// switchable detail) and any future surface render one identical breakdown. Pure presentational.

import type { ScanReport, ScoreIntegrity } from "@/lib/types";
import { scoreHex } from "@/lib/ui";
import { MarkdownLite, renderInline } from "@/components/report/MarkdownLite";
import { ProvenanceTrack } from "@/components/report/ProvenanceTrack";
import { Sparkline, type TrendPoint } from "@/components/report/TrendChart";

export function DimensionDetail({
  d,
  prevScore,
  series,
  integrity,
}: {
  d: ScanReport["dimensions"][number];
  prevScore?: number;
  series?: TrendPoint[];
  /** The scan's `scoreIntegrity`. The provenance track needs it to draw THIS dimension's real band —
   *  a flagged dimension's clamp is DOUBLED, and the realized blend weight shrinks how far the model
   *  can move the number. Absent on a legacy row, where the track says the weight was not recorded
   *  rather than assuming the configured one. */
  integrity?: ScoreIntegrity | null;
}) {
  const delta = prevScore !== undefined ? d.score - prevScore : null;
  return (
    <div className="space-y-3 type-body">
      {/* Headline row — name + weight + score + since-last delta — so the detail stands on its own
          once a bar selects it (the bar list lives in a separate column above). */}
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="type-mono-sm text-slate-500">{d.id}</span>
        <span className="type-lede font-semibold text-white">{d.name}</span>
        <span className="type-body-sm text-slate-500">weight {Math.round(d.weight * 100)}%</span>
        {delta !== null && delta !== 0 && (
          <span className={`type-body-sm font-semibold ${delta > 0 ? "text-emerald-400" : "text-red-400"}`}>
            {delta > 0 ? "▲+" : "▼"}
            {delta} since last scan
          </span>
        )}
        <span className="ml-auto type-heading font-bold tabular-nums" style={{ color: scoreHex(d.score) }}>
          {d.score}
        </span>
      </div>

      {/* The summary is model prose in markdown-lite (short paragraphs · bullets · bold · code) —
          rendered as structure, not as one paragraph. Legacy single-paragraph summaries render as
          exactly that. `text-slate-200`, not 300: this is the body copy of the whole detail, and
          the muted grey read as fine print on the dark surface. */}
      {d.summary && <MarkdownLite text={d.summary} className="text-slate-200" />}

      {d.evidence.length > 0 && (
        <div>
          <div className="type-body-sm font-semibold uppercase tracking-wide text-slate-500">Evidence</div>
          <ul className="mt-1 space-y-1 text-slate-300">
            {d.evidence.map((e, i) => (
              <li key={i} className="flex gap-2">
                <span className="text-slate-600">·</span>
                <span>{renderInline(e)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Gaps as a LIST. They were joined with " · " into one run-on line, which made four distinct
          findings read as one sentence and hid where each ended. */}
      {d.gaps.length > 0 && (
        <div>
          <div className="type-body-sm font-semibold uppercase tracking-wide text-amber-400/80">Gaps</div>
          <ul className="mt-1 space-y-1 text-slate-300">
            {d.gaps.map((g, i) => (
              <li key={i} className="flex gap-2">
                <span className="text-amber-400/60">·</span>
                <span>{renderInline(g)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {series && series.length >= 2 && (
        <div className="flex items-center gap-3 border-t border-divider pt-2">
          <span className="type-body-sm font-semibold uppercase tracking-wide text-slate-500">Trend</span>
          <Sparkline points={series} />
          <span className="type-body-sm text-slate-500">
            {series[0]!.score} → {series[series.length - 1]!.score}
          </span>
        </div>
      )}

      <ProvenanceTrack d={d} integrity={integrity} />
    </div>
  );
}
