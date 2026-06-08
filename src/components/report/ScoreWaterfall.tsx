"use client";

import type { ScanReport } from "@/lib/types";
import { contributions } from "@/lib/scoring/engine";
import { DIMENSION_SHORT, scoreHex } from "@/lib/ui";
import { useMounted, usePrefersReducedMotion } from "@/components/report/Charts";
import { fmtPts } from "@/components/report/PosturePanel";

/**
 * Glass-box score waterfall — the single biggest objection to any rating is "it's a black box",
 * so the headline is decomposed into each dimension's signed marginal contribution. Every
 * dimension adds `(weight / Σweight) × score` points; the segments stack left→right on a 0..100
 * track and collectively reach the overall score, with the remaining headroom shown faint. The
 * itemization below lists each contribution and whether the dimension lifts the overall above its
 * weighted mean (▲) or drags it below (▼) — so the score reads as the visible sum of its parts.
 */
export function ScoreWaterfall({ report }: { report: ScanReport }) {
  const { dimensions, overallScore, total } = contributions(report);
  const mounted = useMounted();
  const reduced = usePrefersReducedMotion();
  // Biggest contributors first — the natural "what's driving my score" reading. Stable tiebreak
  // on dimension id so equal contributors don't reshuffle between renders.
  const ranked = [...dimensions].sort(
    (a, b) => b.points - a.points || a.dimension.localeCompare(b.dimension),
  );

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <div className="font-mono text-sm uppercase tracking-[0.25em] text-accent">Why this score</div>
          <h2 className="mt-1 text-lg font-semibold text-white">Score waterfall</h2>
          <p className="mt-1 text-base text-slate-400">
            Every point attributed — each dimension contributes its{" "}
            <span className="text-slate-300">weight × score</span>, and the parts sum to your headline.
          </p>
        </div>
        <span className="shrink-0 font-mono text-base tabular-nums text-slate-400">
          = <span className="text-xl font-bold text-white">{overallScore}</span>
          <span className="text-slate-400">/100</span>
        </span>
      </div>

      {/* Stacked 0..100 track — colored segments reach the headline; the faint tail is the headroom. */}
      <div
        className="mt-4 flex h-4 w-full overflow-hidden rounded-full bg-slate-800"
        role="img"
        aria-label={`Overall score ${overallScore} of 100, composed of ${ranked.length} weighted dimension contributions`}
      >
        {ranked.map((c, i) => {
          const width = mounted || reduced ? `${c.points}%` : "0%";
          const transition = reduced ? undefined : `width 0.7s ease-out ${Math.min(i * 50, 400)}ms`;
          return (
            <div
              key={c.dimension}
              className="h-full shrink-0 border-r border-slate-950/40 last:border-r-0"
              style={{ width, minWidth: c.points > 0 ? "0.375rem" : 0, backgroundColor: scoreHex(c.score), transition }}
              title={`${c.dimension} ${c.name}: ${c.score}/100 × ${Math.round(c.normalizedWeight * 100)}% weight = +${fmtPts(c.points)} pts`}
            />
          );
        })}
        <div className="h-full flex-1" title={`${fmtPts(Math.max(0, 100 - total))} pts of headroom to 100`} />
      </div>

      {/* Itemized contributions — biggest first; ▲ lifts the overall, ▼ drags it below the mean. */}
      <ul className="mt-4 grid gap-x-6 gap-y-2 sm:grid-cols-2">
        {ranked.map((c) => {
          // Round to display precision before classifying, so a value shown as "0.0" never wears
          // an arrow. The ±0.05 band keeps a dimension sitting on the weighted mean neutral.
          const lift = c.signed > 0.05 ? "up" : c.signed < -0.05 ? "down" : "flat";
          const liftColor =
            lift === "up" ? "text-emerald-400" : lift === "down" ? "text-red-400" : "text-slate-400";
          return (
            <li key={c.dimension} className="flex items-center gap-3 text-base">
              <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: scoreHex(c.score) }} />
              <span className="w-20 shrink-0 truncate text-slate-300">{DIMENSION_SHORT[c.dimension]}</span>
              <span className="flex-1 font-mono text-sm text-slate-400">
                {c.score} × {Math.round(c.normalizedWeight * 100)}%
              </span>
              <span className="w-12 shrink-0 text-right font-mono tabular-nums text-slate-200">+{fmtPts(c.points)}</span>
              <span
                className={`w-12 shrink-0 text-right font-mono text-sm tabular-nums ${liftColor}`}
                title="Lift vs your weighted-mean score — ▲ pulls the overall up, ▼ drags it down"
              >
                {lift === "flat" ? "·" : `${lift === "up" ? "▲+" : "▼"}${fmtPts(Math.abs(c.signed))}`}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
