"use client";

// Dependency-free SVG line chart of overall score over time. Bands shade the maturity
// levels so you can see when a repo crosses a level boundary. A thin hover layer
// (chartHover) adds a crosshair + tooltip without any charting dependency.

import { useId } from "react";
import { useRouter } from "next/navigation";
import { scoreHex } from "@/lib/ui";
import { levelForScore } from "@/lib/maturity/model";
import { ChartTooltip, PointTooltip, useChartHover, useCoarseTapToOpen } from "@/components/report/chartHover";
import { BAND_EDGES, LEVEL_BANDS, vScale, xScale } from "@/components/report/chartScale";

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

/** Tiny inline trend line for a single dimension's score history (0..100 scale). */
export function Sparkline({
  points,
  width = 132,
  height = 34,
}: {
  points: TrendPoint[];
  width?: number;
  height?: number;
}) {
  const x = xScale(points.length, 0, width);
  const y = vScale(height, 3, 3);
  const hover = useChartHover(points.map((_, i) => x(i)), width);

  if (points.length === 0) return null;
  const path = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.score).toFixed(1)}`)
    .join(" ");
  const last = points[points.length - 1]!.score; // safe: length > 0 (guarded above)
  const a = hover.active;

  return (
    <div className="relative inline-block leading-none">
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        aria-hidden
        style={{ touchAction: "none" }}
        onPointerMove={hover.onPointerMove}
        onPointerLeave={hover.onPointerLeave}
      >
        {/* Reference line at the L4 (Advanced) threshold — a real band edge, not an arbitrary 50. */}
        <line x1={0} x2={width} y1={y(65)} y2={y(65)} stroke="#1e293b" strokeWidth={1} strokeDasharray="2 3" />
        {points.length > 1 && <path d={path} fill="none" stroke={scoreHex(last)} strokeWidth={1.75} />}
        {points.map((p, i) => (
          <circle
            key={i}
            cx={x(i)}
            cy={y(p.score)}
            r={i === points.length - 1 ? 2.75 : 1.75}
            fill={scoreHex(p.score)}
          />
        ))}
        {a !== null && (
          <g>
            <line x1={x(a)} x2={x(a)} y1={0} y2={height} stroke="#475569" strokeWidth={1} strokeDasharray="2 2" />
            <circle cx={x(a)} cy={y(points[a]!.score)} r={3.25} fill={scoreHex(points[a]!.score)} stroke="#020617" strokeWidth={1.25} />
          </g>
        )}
        <rect x={0} y={0} width={width} height={height} fill="transparent" />
      </svg>
      {a !== null && (
        // safe: a is a valid index into points (from useChartHover over points); a > 0 guards a-1
        <ChartTooltip xFrac={x(a) / width} yFrac={y(points[a]!.score) / height}>
          <PointTooltip
            score={points[a]!.score}
            at={points[a]!.at}
            engine={points[a]!.engine}
            delta={a > 0 ? points[a]!.score - points[a - 1]!.score : null}
          />
        </ChartTooltip>
      )}
    </div>
  );
}

function shortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function TrendChart({ points }: { points: TrendPoint[] }) {
  const W = 640;
  const H = 220;
  const m = { top: 16, right: 44, bottom: 26, left: 28 };
  const innerW = W - m.left - m.right;
  const innerH = H - m.top - m.bottom;

  const yFor = vScale(H, m.top, m.bottom);
  const xFor = xScale(points.length, m.left, innerW);

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

  const linePath = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${xFor(i).toFixed(1)},${yFor(p.score).toFixed(1)}`)
    .join(" ");

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
        {LEVEL_BANDS.map((b, i) => {
          const top = yFor(i === 0 ? 100 : LEVEL_BANDS[i - 1]!.min); // safe: i > 0 here, i-1 in-bounds
          const bottom = yFor(b.min);
          return (
            <g key={b.min}>
              <rect x={m.left} y={top} width={innerW} height={Math.max(0, bottom - top)} fill={b.color} />
              <text x={m.left + innerW + 5} y={(top + bottom) / 2 + 3} fontSize={8} className="fill-slate-600">
                {`L${LEVEL_BANDS.length - i}`}
              </text>
            </g>
          );
        })}
        {/* y gridlines / labels at band edges */}
        {BAND_EDGES.map((v) => (
          <g key={v}>
            <line x1={m.left} x2={m.left + innerW} y1={yFor(v)} y2={yFor(v)} stroke="#1e293b" strokeWidth={1} />
            <text x={m.left - 6} y={yFor(v) + 3} textAnchor="end" fontSize={9} className="fill-slate-600">
              {v}
            </text>
          </g>
        ))}
        {/* crosshair at the hovered scan */}
        {a !== null && (
          <line x1={xFor(a)} x2={xFor(a)} y1={m.top} y2={m.top + innerH} stroke="#475569" strokeWidth={1} strokeDasharray="3 3" />
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
            <circle cx={xFor(i)} cy={yFor(p.score)} r={i === points.length - 1 ? 5 : 3.5} fill={scoreHex(p.score)} stroke="#020617" strokeWidth={1.5} />
            {showDateLabel(i) && (
              <text x={xFor(i)} y={H - 8} textAnchor="middle" fontSize={9} className="fill-slate-500">
                {shortDate(p.at)}
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
            <th>Report</th>
          </tr>
        </thead>
        <tbody>
          {points.map((p, i) => {
            const lvl = levelForScore(p.score);
            return (
              <tr key={i}>
                <td>{shortDate(p.at)}</td>
                <td>{p.score}</td>
                <td>
                  {lvl.id} {lvl.name}
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
    </div>
  );
}
