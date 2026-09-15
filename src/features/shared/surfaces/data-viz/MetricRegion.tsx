"use client";

// metric-identity: one named metric on four surfaces — a tile, a daily bar strip, a table cell and a
// tooltip line — every one of them reading the SAME `derive()` and `fmtMetric()` from metrics.ts.
// The registry is on screen: id, unit, precision, polarity, window, source. Switching the variant
// chip moves every surface at once because there is one number to move; the 14d variant has no
// previous window, so its delta is a dash, never a fabricated 0. Polarity colours the failed-scans
// delta: the count rose, the arrow points up, and the colour says that is bad.

import { useState } from "react";
import { Stat, deltaHex, fmtDelta } from "@/components/ui";
import { METRICS, favourable, fmtMetric, readMetric, rounded, windowOf, type MetricId } from "./metrics";
import { dayLabel, type Total } from "./fixtures";
import { AxisPredicate, Chips, Readout, Region } from "./sceneParts";

const VARIANTS: readonly { id: MetricId; label: string }[] = [
  { id: "success-rate.fleet.7d", label: "7d" },
  { id: "success-rate.fleet.14d", label: "14d" },
  { id: "failed-scans.fleet.7d", label: "failed · 7d" },
];

export function MetricRegion({ totals, reduced }: { totals: readonly Total[]; reduced: boolean }) {
  const [id, setId] = useState<MetricId>("success-rate.fleet.7d");
  const def = METRICS[id];
  const { current, delta } = readMetric(def, totals);
  const window = windowOf(def, totals);
  // Per-day values on the strip come from the SAME derivation applied to a one-day window.
  const days = totals.map((t) => ({ t, v: def.derive([t]) }));
  const max = Math.max(1, ...days.map((d) => d.v ?? 0));
  const tone = delta === null ? "text-slate-500" : undefined;

  return (
    <Region technique="metric-identity" title="One number, four surfaces" note="The tile, the strip, the cell and the tooltip import one derivation. Switch the registered variant: everything moves together.">
      <Chips label="Metric variant" value={id} options={VARIANTS} onPick={setId} />
      <div className="mt-3 grid gap-4 sm:grid-cols-[auto_1fr]">
        <div className="min-w-[10rem]">
          <Stat
            label={
              <span>
                {def.label} <span className="text-slate-600">· {def.windowDays}d</span>
              </span>
            }
            value={<span data-metric-tile={id}>{fmtMetric(def, current)}</span>}
            color={delta === null ? undefined : deltaHex(favourable(def, delta))}
            sub={
              <span className={tone}>
                {delta === null ? "no previous window — no delta" : `${fmtDelta(rounded(def, delta) ?? 0)} vs previous ${def.windowDays}d`}
              </span>
            }
          />
        </div>
        <div>
          <div className="flex h-16 items-end gap-px" role="img" aria-label={`${def.label} per day, ${def.windowDays}-day window highlighted`}>
            {days.map(({ t, v }) => {
              const inWindow = window.includes(t);
              const pct = v === null ? 0 : (v / max) * 100;
              return (
                <div key={t.day} className="group relative flex-1" title={`${dayLabel(t.day)} · ${fmtMetric(def, v)}${t.partial ? " · today so far" : ""}`}>
                  {v === null ? (
                    <div className="mx-auto h-px w-2 bg-slate-600" aria-label="unmeasured" />
                  ) : (
                    <div
                      className={`w-full rounded-t-sm ${t.partial ? "border border-dashed" : ""} ${inWindow ? "" : "opacity-30"}`}
                      style={{
                        height: `${Math.max(2, pct)}%`,
                        backgroundColor: t.partial ? "transparent" : "var(--color-accent)",
                        borderColor: "var(--color-accent)",
                        transition: reduced ? "none" : "height 240ms ease-out",
                      }}
                    />
                  )}
                </div>
              );
            })}
          </div>
          <AxisPredicate>
            {def.label.toLowerCase()} per day · unit {def.unit} · {def.precision} decimal{def.precision === 1 ? "" : "s"} · source {def.source} · dashed bar = today so far, excluded from the window
          </AxisPredicate>
        </div>
      </div>
      <table className="mt-3 w-full type-caption">
        <thead>
          <tr className="text-left text-slate-500">
            <th className="font-normal">surface</th>
            <th className="font-normal">reads</th>
            <th className="text-right font-normal">value</th>
          </tr>
        </thead>
        <tbody className="text-slate-300">
          <tr className="border-t border-divider">
            <td className="py-1">table cell</td>
            <td className="py-1 text-slate-500">METRICS[{id}].derive → fmtMetric</td>
            <td className="py-1 text-right font-mono tabular-nums" data-metric-cell={id}>
              {fmtMetric(def, current)}
            </td>
          </tr>
          <tr className="border-t border-divider">
            <td className="py-1">tooltip line</td>
            <td className="py-1 text-slate-500">same door, same formatter</td>
            <td className="py-1 text-right font-mono tabular-nums" data-metric-tip={id}>
              {fmtMetric(def, current)} · {def.windowDays}d
            </td>
          </tr>
        </tbody>
      </table>
      <div className="mt-3 space-y-1">
        <Readout label="id" value={def.id} />
        <Readout label="polarity" value={def.polarity} tone={def.polarity === "lower-better" ? "text-warn" : "text-slate-200"} />
        <Readout label="window" value={`${def.windowDays} complete days · partial excluded`} />
      </div>
    </Region>
  );
}
