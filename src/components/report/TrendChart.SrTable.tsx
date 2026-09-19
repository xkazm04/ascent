"use client";

// Screen-reader equivalent of the trend chart — the bands/points convey meaning visually, so the
// series is mirrored as a table referenced by the svg's `aria-describedby` (matches the radar chart).
// The svg is role="img" + pointer-only click, so the per-point "open this scan" deep links would
// otherwise be mouse-only (WCAG 2.1.1 / 4.1.2). They are exposed here as real focusable links so
// keyboard and screen-reader users reach the same target without a pointer.
//
// Extracted from TrendChart.tsx to keep that file inside the 300-LOC rule when the compaction
// encoding landed (MOONSHOT #32). Pure relocation — the only change is the "Scored by" cell, which
// now also names a compacted point for what it is, since the dashed/hollow encoding is visual only.

import { levelForScore } from "@/lib/maturity/model";
import { isMockEngine } from "@/components/report/chartEngine";
import { shortDateSafe } from "@/components/ui/format";
import type { TrendPoint } from "@/components/report/TrendChart";

export function TrendSrTable({ id, points }: { id: string; points: readonly TrendPoint[] }) {
  return (
    <table id={id} className="sr-only">
      <caption>Overall maturity score over time</caption>
      <thead>
        <tr>
          <th>Scan date</th>
          <th>Score</th>
          <th>Level</th>
          {/* Provenance is a caveat, not trivia: the hollow-mark encoding is pointer-only, so the
              table carries which points a model actually scored — and which are summaries. */}
          <th>Scored by</th>
          <th>Report</th>
        </tr>
      </thead>
      <tbody>
        {points.map((p, i) => {
          const lvl = levelForScore(p.score);
          return (
            <tr key={i}>
              <td>{shortDateSafe(p.at)}</td>
              <td>{p.score}</td>
              <td>
                {lvl.id} {lvl.name}
              </td>
              <td>
                {p.compacted
                  ? `compacted: period average of ${p.scans ?? 0} scans`
                  : isMockEngine(p.engine)
                    ? "demo scan: deterministic rubric, no model"
                    : (p.engine ?? "—")}
              </td>
              <td>
                {p.href ? <a href={p.href}>Open this scan&apos;s report</a> : "—"}
                {p.commitUrl && (
                  <>
                    {p.href ? " · " : ""}
                    <a href={p.commitUrl} target="_blank" rel="noopener noreferrer">
                      GitHub commit
                    </a>
                  </>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
