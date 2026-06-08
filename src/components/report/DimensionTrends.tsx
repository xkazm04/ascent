"use client";

// Dimension-level trends — small-multiples line charts, one per dimension, over the
// repo's scan history. A 'Last 5 / 30 / 90 days / All' range toggle slices the scan list
// before any points are mapped; the charts add a hover crosshair + tooltip (chartHover).

import { useCallback, useEffect, useRef, useState } from "react";
import { DIMENSIONS, DIMENSION_BY_ID } from "@/lib/maturity/model";
import { reportPermalink, scoreGlyph, scoreHex } from "@/lib/ui";
import type { HistoryPoint, RepositoryHistory } from "@/lib/db/scans";
import { parseRepositoryHistory } from "@/lib/report/validate";
import { EmptyState } from "@/components/EmptyState";
import { TrendChart, type TrendPoint } from "@/components/report/TrendChart";
import { BAND_EDGES, LEVEL_BANDS, vScale, xScale } from "@/components/report/chartScale";
import { ChartTooltip, PointTooltip, useChartHover } from "@/components/report/chartHover";

/** Per-scan metadata aligned 1:1 with a DimLine's values array (for hover tooltips). */
interface ScanMeta {
  at: string;
  engine: string;
}

/**
 * Responsive 0..100 line chart that fills its container width. A `null` value marks a
 * scan where this dimension was ABSENT (e.g. a dimension added after that scan) — it is
 * rendered as a gap in the line, never as a 0. Coercing absent→0 would fabricate a
 * crash-to-zero-and-recover that never happened. Hover snaps to the nearest present point.
 */
function DimLine({
  values,
  meta,
  name,
  current,
}: {
  values: (number | null)[];
  meta: ScanMeta[];
  name?: string;
  current?: number;
}) {
  const W = 320;
  const H = 90;
  const x = xScale(values.length, 0, W);
  const y = vScale(H, 8, 8);

  // Only the present points are hoverable — gaps have no value to show.
  const present = values
    .map((v, i) => ({ v, i }))
    .filter((p): p is { v: number; i: number } => p.v !== null);
  const hover = useChartHover(present.map((p) => x(p.i)), W);
  const a = hover.active;

  // Build the path in segments, breaking it wherever a value is missing so the line never
  // dives through 0 to bridge a gap.
  let path = "";
  let penDown = false;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v == null) {
      // null marks a gap; undefined is unreachable (i is in-bounds) but narrows v to number
      penDown = false;
      continue;
    }
    path += `${penDown ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)} `;
    penDown = true;
  }

  const lastReal = [...values].reverse().find((v): v is number => v !== null) ?? 0;
  const drawnCount = present.length;
  const act = a !== null ? present[a] : null;
  // Delta vs the prior PRESENT point (gaps are skipped, so this compares real scans).
  // safe: a is a valid index into present (from useChartHover over present), and a > 0
  const actDelta = a !== null && a > 0 ? present[a]!.v - present[a - 1]!.v : null;

  return (
    <div className="relative mt-2">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        role="img"
        aria-label={
          name
            ? `${name} score trend${current !== undefined ? `, currently ${current} of 100` : ""}`
            : "Dimension trend"
        }
        style={{ touchAction: "none" }}
        onPointerMove={hover.onPointerMove}
        onPointerLeave={hover.onPointerLeave}
      >
        {/* Shaded maturity bands — same strata as the overall chart, so both read on one frame. */}
        {LEVEL_BANDS.map((band, i) => {
          const top = y(i === 0 ? 100 : LEVEL_BANDS[i - 1]!.min); // safe: i > 0 here, i-1 in-bounds
          const bottom = y(band.min);
          return <rect key={band.min} x={0} y={top} width={W} height={Math.max(0, bottom - top)} fill={band.color} />;
        })}
        {BAND_EDGES.filter((e) => e > 0 && e < 100).map((b) => (
          <line key={b} x1={0} x2={W} y1={y(b)} y2={y(b)} stroke="#1e293b" strokeWidth={1} strokeDasharray="2 4" />
        ))}
        {/* One mid-scale reference so the sparkline reads as a quantitative chart, not a floating
            squiggle — the L4 "Integrated" threshold (65) anchors the otherwise-unlabeled bands. */}
        <text x={3} y={y(65) - 2} fontSize={8} className="fill-slate-600">
          65
        </text>
        {act && <line x1={x(act.i)} x2={x(act.i)} y1={0} y2={H} stroke="#475569" strokeWidth={1} strokeDasharray="3 3" />}
        {drawnCount > 1 && <path d={path.trim()} fill="none" stroke={scoreHex(lastReal)} strokeWidth={2.25} />}
        {values.map((v, i) =>
          v === null ? null : (
            <circle key={i} cx={x(i)} cy={y(v)} r={i === values.length - 1 ? 4 : 2.5} fill={scoreHex(v)} />
          ),
        )}
        {act && (
          <circle cx={x(act.i)} cy={y(act.v)} r={5.5} fill="none" stroke={scoreHex(act.v)} strokeWidth={1.75} />
        )}
        <rect x={0} y={0} width={W} height={H} fill="transparent" />
      </svg>
      {act && (
        <ChartTooltip xFrac={x(act.i) / W} yFrac={y(act.v) / H}>
          <PointTooltip
            score={act.v}
            at={meta[act.i]?.at}
            engine={meta[act.i]?.engine}
            delta={actDelta}
          />
        </ChartTooltip>
      )}
    </div>
  );
}

const RANGES = [
  { key: "5d", label: "5d", days: 5 },
  { key: "30d", label: "30d", days: 30 },
  { key: "90d", label: "90d", days: 90 },
  { key: "all", label: "All", days: null },
] as const;

type RangeKey = (typeof RANGES)[number]["key"];

/** Keep scans within `days` of now (newest-first order preserved); `null` keeps all. */
function withinRange(scans: HistoryPoint[], days: number | null): HistoryPoint[] {
  if (days === null) return scans;
  const cutoff = Date.now() - days * 86_400_000;
  return scans.filter((s) => {
    const t = Date.parse(s.scannedAt);
    return Number.isNaN(t) ? true : t >= cutoff;
  });
}

function RangeToggle({ value, onChange }: { value: RangeKey; onChange: (k: RangeKey) => void }) {
  return (
    <div className="inline-flex rounded-lg border border-slate-800 bg-slate-900/60 p-0.5 font-mono text-sm">
      {RANGES.map((r) => {
        const active = r.key === value;
        return (
          <button
            key={r.key}
            type="button"
            onClick={() => onChange(r.key)}
            aria-pressed={active}
            className={`rounded-md px-2.5 py-1 uppercase tracking-wider transition ${
              active ? "bg-accent text-on-accent" : "text-slate-400 hover:text-white"
            }`}
          >
            {r.label}
          </button>
        );
      })}
    </div>
  );
}

export function DimensionTrends({ history }: { history: RepositoryHistory }) {
  const [range, setRange] = useState<RangeKey>("all");
  const days = RANGES.find((r) => r.key === range)?.days ?? null;

  // The OVERALL series is available immediately from the (lightweight, overall-only) history the
  // server passes, so the first paint stays light. The per-dimension small-multiples need the
  // heavier per-dimension rows, so they're lazy-loaded client-side only when the "By dimension"
  // section approaches the viewport. If the caller already passed a full history (dimensions
  // present), skip the fetch and render immediately — back-compatible with full-history callers.
  const serverHasDims = history.scans.some((s) => s.dimensions.length > 0);
  const [full, setFull] = useState<RepositoryHistory | null>(serverHasDims ? history : null);
  const [dimState, setDimState] = useState<"idle" | "loading" | "error" | "done">(
    serverHasDims ? "done" : "idle",
  );
  const dimRef = useRef<HTMLDivElement | null>(null);

  const loadDimensions = useCallback(async () => {
    setDimState("loading");
    try {
      const res = await fetch(`/api/history?repo=${encodeURIComponent(history.repo.fullName)}`);
      if (!res.ok) throw new Error(`history ${res.status}`);
      setFull(parseRepositoryHistory(await res.json()));
      setDimState("done");
    } catch {
      setDimState("error");
    }
  }, [history.repo.fullName]);

  // Fetch the per-dimension data once its section nears the viewport (or immediately where there's
  // no IntersectionObserver, e.g. a test/SSR-less env).
  useEffect(() => {
    if (dimState !== "idle") return;
    const el = dimRef.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      // No IntersectionObserver (e.g. JSDOM / older env): load on the next tick rather than calling
      // setState synchronously inside the effect body.
      const t = setTimeout(() => void loadDimensions(), 0);
      return () => clearTimeout(t);
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          io.disconnect();
          void loadDimensions();
        }
      },
      { rootMargin: "200px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [dimState, loadDimensions]);

  // Overall series — always available from the lightweight payload, sliced by the active range.
  const overallScans = withinRange(history.scans, days); // newest-first
  const overallChrono = [...overallScans].reverse();
  const overall: TrendPoint[] = overallChrono.map((s) => ({
    score: s.overallScore,
    at: s.scannedAt,
    engine: s.engineProvider,
    // Deep-link each point to that scan's pinned report (and show the short sha) when we recorded
    // the commit — so a trend dot opens the exact report instead of being a dead end.
    href: s.headSha ? reportPermalink(history.repo.fullName, s.headSha) : undefined,
    sha: s.headSha ? s.headSha.slice(0, 7) : undefined,
  }));

  // Per-dimension rows — from the full payload once loaded, sliced by the SAME range.
  const dimScans = full ? withinRange(full.scans, days) : [];
  const dimChrono = [...dimScans].reverse();
  const meta: ScanMeta[] = dimChrono.map((s) => ({ at: s.scannedAt, engine: s.engineProvider }));
  const latest = dimScans[0];
  const prev = dimScans[1];
  const rows = DIMENSIONS.map((def) => {
    // null (not 0) for scans where this dimension is absent — see DimLine.
    const series = dimChrono.map((s) => s.dimensions.find((d) => d.dimId === def.id)?.score ?? null);
    const current = latest?.dimensions.find((d) => d.dimId === def.id)?.score;
    const prevScore = prev?.dimensions.find((d) => d.dimId === def.id)?.score;
    // Delta only when BOTH scans actually contain the dimension — otherwise it's not a
    // real change (current-minus-0 would invent a huge false drop/gain).
    const delta = current !== undefined && prevScore !== undefined ? current - prevScore : null;
    return { id: def.id, name: DIMENSION_BY_ID[def.id].name, weight: def.weight, current, series, delta };
  });

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="font-mono text-sm uppercase tracking-widest text-slate-500">
          {overallScans.length} {overallScans.length === 1 ? "scan" : "scans"} shown
        </div>
        <RangeToggle value={range} onChange={setRange} />
      </div>

      {overallScans.length === 0 ? (
        <EmptyState icon="📈" title="No scans in the selected range" body="Try a wider window.">
          <button
            type="button"
            onClick={() => setRange("all")}
            className="rounded-xl border border-slate-700 px-5 py-2.5 text-base text-slate-300 transition hover:border-accent hover:text-white"
          >
            Show all
          </button>
        </EmptyState>
      ) : (
        <>
          <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
            <h2 className="text-lg font-semibold text-white">Overall maturity</h2>
            <div className="mt-3">
              <TrendChart points={overall} />
            </div>
          </div>

          <div ref={dimRef}>
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white">By dimension</h2>
              <span className="font-mono text-sm uppercase tracking-widest text-slate-500">
                {overallChrono.length} scans
              </span>
            </div>

            {dimState === "done" ? (
              <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {rows.map((r) => (
                  <div key={r.id} className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
                    <div className="flex items-start justify-between">
                      <div>
                        <span className="font-mono text-sm text-slate-500">{r.id}</span>
                        <h3 className="text-base font-semibold text-white">{r.name}</h3>
                      </div>
                      <div className="text-right">
                        <div
                          className="font-mono text-xl font-bold tabular-nums"
                          style={{ color: r.current !== undefined ? scoreHex(r.current) : "#475569" }}
                        >
                          {/* Redundant (non-color) cue so the score's level reads without relying on
                              hue alone (CVD) — mirrors the report's treatment. */}
                          {r.current !== undefined && (
                            <span aria-hidden className="mr-1 align-middle text-sm">
                              {scoreGlyph(r.current)}
                            </span>
                          )}
                          {r.current ?? "—"}
                        </div>
                        {r.delta !== null && r.delta !== 0 && (
                          <div className={`text-sm font-semibold ${r.delta > 0 ? "text-emerald-400" : "text-red-400"}`}>
                            {r.delta > 0 ? "▲+" : "▼"}
                            {r.delta}
                          </div>
                        )}
                      </div>
                    </div>
                    <DimLine values={r.series} meta={meta} name={r.name} current={r.current} />
                  </div>
                ))}
              </div>
            ) : dimState === "error" ? (
              <div className="mt-4">
                <EmptyState variant="section" title="Couldn't load the per-dimension breakdown">
                  <button
                    type="button"
                    onClick={() => void loadDimensions()}
                    className="rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-300 transition hover:border-accent hover:text-white"
                  >
                    Retry
                  </button>
                </EmptyState>
              </div>
            ) : (
              // idle / loading — shimmer placeholder cards while the dimension rows load.
              <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-hidden>
                {[0, 1, 2, 3, 4, 5].map((i) => (
                  <div key={i} className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
                    <div className="h-4 w-24 animate-pulse rounded bg-slate-800" />
                    <div className="mt-3 h-[90px] w-full animate-pulse rounded bg-slate-800/60" />
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
