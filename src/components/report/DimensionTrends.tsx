"use client";

// Dimension-level trends — small-multiples line charts, one per dimension, over the
// repo's scan history. A 'Last 5 / 30 / 90 days / All' range toggle slices the scan list
// before any points are mapped; the charts add a hover crosshair + tooltip (chartHover).

import { useState } from "react";
import { DIMENSIONS, DIMENSION_BY_ID } from "@/lib/maturity/model";
import { scoreHex } from "@/lib/ui";
import type { HistoryPoint, RepositoryHistory } from "@/lib/db/scans";
import { TrendChart, type TrendPoint } from "@/components/report/TrendChart";
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
function DimLine({ values, meta }: { values: (number | null)[]; meta: ScanMeta[] }) {
  const W = 320;
  const H = 90;
  const x = (i: number) => (values.length < 2 ? W / 2 : (W * i) / (values.length - 1));
  const y = (v: number) => H - 8 - ((H - 16) * v) / 100;

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
    if (v === null) {
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
  const actDelta = a !== null && a > 0 ? present[a].v - present[a - 1].v : null;

  return (
    <div className="relative mt-2">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        role="img"
        aria-label="Dimension trend"
        style={{ touchAction: "none" }}
        onPointerMove={hover.onPointerMove}
        onPointerLeave={hover.onPointerLeave}
      >
        {[25, 45, 65, 85].map((b) => (
          <line key={b} x1={0} x2={W} y1={y(b)} y2={y(b)} stroke="#1e293b" strokeWidth={1} strokeDasharray="2 4" />
        ))}
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
    <div className="inline-flex rounded-lg border border-slate-800 bg-slate-900/60 p-0.5 font-mono text-[11px]">
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

  const scans = withinRange(history.scans, days); // newest-first, sliced by range
  const scansChrono = [...scans].reverse();
  const meta: ScanMeta[] = scansChrono.map((s) => ({ at: s.scannedAt, engine: s.engineProvider }));
  const overall: TrendPoint[] = scansChrono.map((s) => ({
    score: s.overallScore,
    at: s.scannedAt,
    engine: s.engineProvider,
  }));
  const latest = scans[0];
  const prev = scans[1];

  // Order dimensions by the canonical model order.
  const rows = DIMENSIONS.map((def) => {
    // null (not 0) for scans where this dimension is absent — see DimLine.
    const series = scansChrono.map(
      (s) => s.dimensions.find((d) => d.dimId === def.id)?.score ?? null,
    );
    const current = latest?.dimensions.find((d) => d.dimId === def.id)?.score;
    const prevScore = prev?.dimensions.find((d) => d.dimId === def.id)?.score;
    // Delta only when BOTH scans actually contain the dimension — otherwise it's not a
    // real change (current-minus-0 would invent a huge false drop/gain).
    const delta =
      current !== undefined && prevScore !== undefined ? current - prevScore : null;
    return { id: def.id, name: DIMENSION_BY_ID[def.id].name, weight: def.weight, current, series, delta };
  });

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="font-mono text-[11px] uppercase tracking-widest text-slate-500">
          {scans.length} {scans.length === 1 ? "scan" : "scans"} shown
        </div>
        <RangeToggle value={range} onChange={setRange} />
      </div>

      {scans.length === 0 ? (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-10 text-center">
          <p className="text-sm text-slate-400">
            No scans in the selected range. Try a wider window.
          </p>
          <button
            type="button"
            onClick={() => setRange("all")}
            className="mt-3 rounded-lg border border-slate-700 px-3 py-1.5 text-xs text-slate-300 transition hover:border-accent hover:text-white"
          >
            Show all
          </button>
        </div>
      ) : (
        <>
          <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
            <h2 className="text-lg font-semibold text-white">Overall maturity</h2>
            <div className="mt-3">
              <TrendChart points={overall} />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold text-white">By dimension</h2>
              <span className="font-mono text-[11px] uppercase tracking-widest text-slate-500">
                {scansChrono.length} scans
              </span>
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {rows.map((r) => (
                <div key={r.id} className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <span className="font-mono text-[10px] text-slate-500">{r.id}</span>
                      <h3 className="text-sm font-semibold text-white">{r.name}</h3>
                    </div>
                    <div className="text-right">
                      <div
                        className="font-mono text-xl font-bold tabular-nums"
                        style={{ color: r.current !== undefined ? scoreHex(r.current) : "#475569" }}
                      >
                        {r.current ?? "—"}
                      </div>
                      {r.delta !== null && r.delta !== 0 && (
                        <div className={`text-xs font-semibold ${r.delta > 0 ? "text-emerald-400" : "text-red-400"}`}>
                          {r.delta > 0 ? "▲+" : "▼"}
                          {r.delta}
                        </div>
                      )}
                    </div>
                  </div>
                  <DimLine values={r.series} meta={meta} />
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
