"use client";

import type { ScanReport } from "@/lib/types";
import { contributions } from "@/lib/scoring/engine";
import { DIMENSION_SHORT, fmtPts, scoreHex } from "@/lib/ui";
import { fillBarStyle, useMounted, usePrefersReducedMotion } from "@/components/report/chartMotion";
import { ScoreBarTrack } from "@/components/report/FillBar";
import {
  AGGREGATE_HEX,
  MICRO_POINTS,
  waterfallHeadroom,
  waterfallSegments,
} from "@/components/report/scoreWaterfallSegments";
import { Kicker, Surface } from "@/components/ui";

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
  // Segment widths are the contributions' TRUE shares — no pixel floor (see scoreWaterfallSegments):
  // floors summed past the track and squeezed the headroom tail to zero. Sub-1.5pt contributions are
  // rolled into one neutral sliver instead of being either overstated or hidden.
  const segments = waterfallSegments(ranked);
  const aggregated = segments.find((s) => s.count > 1);
  const headroom = waterfallHeadroom(total);

  return (
    <Surface radius="2xl" className="p-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <Kicker tone="accent">Why this score</Kicker>
          <h2 className="mt-1 text-lg font-semibold text-white">Score waterfall</h2>
          <p className="mt-1 text-base text-slate-400">
            Every point attributed: each dimension contributes its{" "}
            <span className="text-slate-300">weight × score</span>, and the parts sum to your headline.
          </p>
        </div>
        <span className="shrink-0 font-mono text-base tabular-nums text-slate-400">
          = <span className="text-xl font-bold text-white">{overallScore}</span>
          <span className="text-slate-400">/100</span>
        </span>
      </div>

      {/* Stacked 0..100 track — colored segments reach the headline; the faint tail is the headroom. */}
      <ScoreBarTrack
        className="mt-4 flex h-4 w-full overflow-hidden rounded-full bg-slate-800"
        role="img"
        aria-label={`Overall score ${overallScore} of 100, composed of ${ranked.length} weighted dimension contributions`}
      >
        {segments.map((s, i) => {
          const { width, transition } = fillBarStyle({ pct: s.points, index: i, mounted, reduced, stagger: 50, cap: 400 });
          return (
            <div
              key={s.key}
              data-segment={s.key}
              className="h-full shrink-0 border-r border-slate-950/40 last:border-r-0"
              style={{ width, backgroundColor: s.score === null ? AGGREGATE_HEX : scoreHex(s.score), transition }}
              title={s.title}
            />
          );
        })}
        {/* Headroom to 100. Its width is the honest remainder (flex-1 absorbs the float residue), but
            a non-zero headroom keeps a 2px floor so the "distance left" indicator can never be
            rounded out of existence — a zero headroom (a perfect 100) still renders nothing. */}
        <div
          data-headroom
          className="h-full flex-1"
          style={{ minWidth: headroom > 0 ? "0.125rem" : 0 }}
          title={`${fmtPts(headroom)} pts of headroom to 100`}
        />
      </ScoreBarTrack>

      {aggregated && (
        <p className="mt-2 text-sm text-slate-500">
          The grey sliver aggregates {aggregated.count} dimensions contributing under {fmtPts(MICRO_POINTS)} pts each.
          Each is itemized in full below.
        </p>
      )}

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
                title="Lift vs your weighted-mean score: ▲ pulls the overall up, ▼ drags it down"
              >
                {lift === "flat" ? "·" : `${lift === "up" ? "▲+" : "▼"}${fmtPts(Math.abs(c.signed))}`}
              </span>
            </li>
          );
        })}
      </ul>
    </Surface>
  );
}
