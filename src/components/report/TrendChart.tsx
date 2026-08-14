"use client";

// Dependency-free SVG line chart of overall score over time. Bands shade the maturity
// levels so you can see when a repo crosses a level boundary. A thin hover layer
// (chartHover) adds a crosshair + tooltip without any charting dependency.

import { useId } from "react";
import { useRouter } from "next/navigation";
import type { TrendAnnotation } from "@/app/trends/annotations";
import { scoreHex } from "@/lib/ui";
import { levelForScore } from "@/lib/maturity/model";
import { ChartTooltip, PointTooltip, useChartHover, useCoarseTapToOpen } from "@/components/report/chartHover";
import { BAND_EDGES, CHART_INK, levelBandRects, vScale, xScale } from "@/components/report/chartScale";
import { MOCK_POINT_NOTE, hasMockPoint, isMockEngine } from "@/components/report/chartEngine";
import { shortDateSafe } from "@/components/ui/format";

export interface TrendPoint {
  score: number;
  at: string; // ISO
  engine?: string; // provider that produced this scan, when known (omitted for org rollups)
  /** Permalink to this scan's pinned report. When set, the chart navigates here on click of the
   *  hovered point — so a trend dot is no longer a dead end. Omitted for org rollup points (daily
   *  averages with no single underlying scan), which therefore stay non-interactive. */
  href?: string;
  /** Short commit sha, shown in the hover tooltip as context for the point. */
  sha?: string;
  /** External GitHub commit URL (githubCommitUrl) — shift-click on the hovered point opens it in
   *  a new tab, closing the "what landed here?" investigation loop. Omitted = no external jump. */
  commitUrl?: string;
}

// Sparkline lives in a co-located file to keep this file within the 300-LOC limit; re-exported
// here so its public import path (@/components/report/TrendChart) is unchanged.
export { Sparkline } from "@/components/report/TrendChart.Sparkline";

export function TrendChart({ points, annotations = [] }: { points: TrendPoint[]; annotations?: TrendAnnotation[] }) {
  const W = 640;
  const H = 220;
  const m = { top: 16, right: 44, bottom: 26, left: 28 };
  const innerW = W - m.left - m.right;
  const innerH = H - m.top - m.bottom;

  const yFor = vScale(H, m.top, m.bottom);
  const xFor = xScale(points.length, m.left, innerW);
  const bands = levelBandRects(yFor);

  const hover = useChartHover(points.map((_, i) => xFor(i)), W);
  const a = hover.active;
  const tap = useCoarseTapToOpen();
  const tableId = useId();
  const router = useRouter();
  // The hovered point's report permalink, when it has one — clicking anywhere on the plot opens it
  // (a far bigger hit target than the small dot). Points without an href (org rollups) do nothing.
  const activeHref = a !== null ? points[a]?.href : undefined;
  // Shift-click escape hatch to the exact GitHub commit (new tab, noopener) — the external half
  // of the investigation loop. Plain click keeps the in-app permalink as the primary action.
  const activeCommitUrl = a !== null ? points[a]?.commitUrl : undefined;

  // Thin the x-axis date labels so interior dates don't vanish (the old rule showed only first +
  // last past 6 points) and don't collide at 60 scans: aim for ~7 evenly-spaced labels, always
  // keeping the first and last.
  const labelStep = Math.max(1, Math.ceil(points.length / 7));
  const showDateLabel = (i: number) =>
    i === 0 || i === points.length - 1 || (i % labelStep === 0 && i < points.length - 1);

  // Resolve each annotation to a visible index by timestamp identity; drop the ones whose scan isn't
  // in the current slice. Built once per render rather than scanning `points` inside the map.
  const indexByAt = new Map(points.map((p, i) => [p.at, i]));
  const annotationMarks = annotations
    .map((ann) => ({ ann, i: indexByAt.get(ann.at) }))
    .filter((m): m is { ann: TrendAnnotation; i: number } => m.i !== undefined);

  const linePath = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${xFor(i).toFixed(1)},${yFor(p.score).toFixed(1)}`)
    .join(" ");

  // Mock (keyless, deterministic-rubric) scans are not comparable to model-scored ones — see
  // chartEngine. Any mock point in the series arms the footnote below, which is the legend for the
  // hollow marks; without it the shape difference would be an unexplained encoding.
  const showEngineNote = hasMockPoint(points.map((p) => p.engine));

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label="Overall score over time"
        aria-describedby={tableId}
        style={{ touchAction: "none", cursor: activeHref || activeCommitUrl ? "pointer" : undefined }}
        onPointerMove={(e) => {
          tap.notePointer(e);
          hover.onPointerMove(e);
        }}
        // Also snap on pointer-down so a stationary touch tap (which may not fire pointermove) still
        // reveals the nearest point before the click is evaluated.
        onPointerDown={(e) => {
          tap.notePointer(e);
          hover.onPointerMove(e);
        }}
        onPointerLeave={hover.onPointerLeave}
        onClick={(e) => {
          if (e.shiftKey && activeCommitUrl) window.open(activeCommitUrl, "_blank", "noopener");
          // On touch the first tap only reveals the point's tooltip; a second tap on it navigates.
          else if (activeHref && tap.shouldOpen(a)) router.push(activeHref);
        }}
      >
        {/* level bands + their L-id labels — a non-color cue so each shaded range is identifiable
            (the bands previously carried meaning in near-invisible fill opacity alone) */}
        {bands.map((b, i) => (
          <g key={b.min}>
            <rect x={m.left} y={b.top} width={innerW} height={b.height} fill={b.color} />
            <text x={m.left + innerW + 5} y={b.top + b.height / 2 + 3} fontSize={8} className="fill-slate-600">
              {`L${bands.length - i}`}
            </text>
          </g>
        ))}
        {/* y gridlines / labels at band edges */}
        {BAND_EDGES.map((v) => (
          <g key={v}>
            <line x1={m.left} x2={m.left + innerW} y1={yFor(v)} y2={yFor(v)} stroke="var(--color-divider)" strokeWidth={1} />
            <text x={m.left - 6} y={yFor(v) + 3} textAnchor="end" fontSize={9} className="fill-slate-600">
              {v}
            </text>
          </g>
        ))}
        {/* G5-18: event markers (level crossings, regressions). Positioned by matching the annotation's
            `at` against each point's own `at` — NEVER by array index, because the range toggle slices
            `points` while the annotation list is derived from the full history. An annotation whose
            scan is outside the visible slice simply doesn't render; it is never clamped to an edge,
            which would plant a marker on a scan it doesn't describe. */}
        {annotationMarks.map(({ ann, i }) => (
          <g key={ann.scanId}>
            <line
              x1={xFor(i)}
              x2={xFor(i)}
              y1={m.top}
              y2={m.top + innerH}
              stroke="var(--color-divider)"
              strokeWidth={1}
              strokeDasharray="2 4"
            />
            <text x={xFor(i)} y={m.top - 5} textAnchor="middle" fontSize={8} className="fill-slate-500">
              {ann.label}
              <title>{ann.detail}</title>
            </text>
          </g>
        ))}
        {/* crosshair at the hovered scan */}
        {a !== null && (
          <line x1={xFor(a)} x2={xFor(a)} y1={m.top} y2={m.top + innerH} stroke={CHART_INK.crosshair} strokeWidth={1} strokeDasharray="3 3" />
        )}
        {/* line + points */}
        {/* Line color follows the latest score (red→green ramp), matching DimLine + Sparkline. */}
        {points.length > 1 && (
          // safe: length > 1, so the last index is in-bounds
          <path d={linePath} fill="none" stroke={scoreHex(points[points.length - 1]!.score)} strokeWidth={2.5} />
        )}
        {points.length > 1 && points.every((p) => p.score === points[0]!.score) && (
          // A flat (zero-variance) series sits on a horizontal line that can coincide with a band
          // gridline — label it so a genuine "holding steady" trend doesn't read as a rendering glitch.
          <text
            x={m.left + innerW / 2}
            y={yFor(points[0]!.score) - 8}
            textAnchor="middle"
            fontSize={10}
            fontWeight={600}
            fill={scoreHex(points[0]!.score)}
          >
            Holding at {points[0]!.score}
          </text>
        )}
        {points.map((p, i) => (
          <g key={i}>
            {/* A mock-scored point is drawn HOLLOW (surface fill, score-colored stroke) instead of
                solid: the model contributed nothing to it, so it must not read as a measured value
                on the same footing as its neighbours. The hue stays the score's, so the value ramp
                and CVD-safety are unchanged — the caveat rides on the mark, not the colour. */}
            {isMockEngine(p.engine) ? (
              <circle data-mock cx={xFor(i)} cy={yFor(p.score)} r={i === points.length - 1 ? 5 : 3.5} fill="var(--color-surface-strong)" stroke={scoreHex(p.score)} strokeWidth={2} />
            ) : (
              <circle cx={xFor(i)} cy={yFor(p.score)} r={i === points.length - 1 ? 5 : 3.5} fill={scoreHex(p.score)} stroke="var(--color-surface-strong)" strokeWidth={1.5} />
            )}
            {showDateLabel(i) && (
              <text x={xFor(i)} y={H - 8} textAnchor="middle" fontSize={9} className="fill-slate-500">
                {shortDateSafe(p.at)}
              </text>
            )}
          </g>
        ))}
        {/* hovered point highlight */}
        {a !== null && (
          // safe: a is a valid index into points (from useChartHover over points)
          <circle cx={xFor(a)} cy={yFor(points[a]!.score)} r={6.5} fill="none" stroke={scoreHex(points[a]!.score)} strokeWidth={2} />
        )}
        {/* last value label — anchored to the right edge when it would otherwise spill past the
            viewBox (the last point sits at the right of the plot), so it never clips */}
        {points.length > 0 &&
          (() => {
            const lastX = xFor(points.length - 1);
            const atEdge = lastX + 8 + 24 > W;
            const lastScore = points[points.length - 1]!.score; // safe: length > 0, last index in-bounds
            return (
              <text
                x={atEdge ? W - 2 : lastX + 8}
                y={yFor(lastScore) + 3}
                textAnchor={atEdge ? "end" : "start"}
                fontSize={12}
                fontWeight={700}
                fill={scoreHex(lastScore)}
              >
                {lastScore}
              </text>
            );
          })()}
        {/* transparent capture layer so pointer moves register across the whole plot */}
        <rect x={0} y={0} width={W} height={H} fill="transparent" />
      </svg>
      {a !== null && (
        // safe: a is a valid index into points (from useChartHover over points); a > 0 guards a-1
        <ChartTooltip xFrac={xFor(a) / W} yFrac={yFor(points[a]!.score) / H}>
          <PointTooltip
            score={points[a]!.score}
            at={points[a]!.at}
            engine={points[a]!.engine}
            delta={a > 0 ? points[a]!.score - points[a - 1]!.score : null}
            sha={points[a]!.sha}
            linked={Boolean(points[a]!.href)}
            commitLinked={Boolean(points[a]!.commitUrl)}
          />
        </ChartTooltip>
      )}
      {showEngineNote && (
        <p className="mt-2 flex items-start gap-2 text-sm text-slate-500">
          <svg aria-hidden viewBox="0 0 12 12" className="mt-1 h-3 w-3 shrink-0">
            <circle cx={6} cy={6} r={4} fill="var(--color-surface-strong)" stroke="currentColor" strokeWidth={2} />
          </svg>
          <span>{MOCK_POINT_NOTE}</span>
        </p>
      )}
      {/* Screen-reader equivalent of the chart — the bands/points convey meaning visually, so mirror
          the series as a table referenced by the svg's aria-describedby (matches the radar chart).
          The svg is role="img" + pointer-only click, so the per-point "open this scan" deep links
          would otherwise be mouse-only (WCAG 2.1.1 / 4.1.2). Expose them here as real focusable
          links so keyboard and screen-reader users can reach the same target without a pointer. */}
      <table id={tableId} className="sr-only">
        <caption>Overall maturity score over time</caption>
        <thead>
          <tr>
            <th>Scan date</th>
            <th>Score</th>
            <th>Level</th>
            {/* Provenance is a caveat, not trivia: the hollow-mark encoding is pointer-only, so the
                table carries which points a model actually scored. */}
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
                <td>{isMockEngine(p.engine) ? "demo scan: deterministic rubric, no model" : (p.engine ?? "—")}</td>
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
    </div>
  );
}
