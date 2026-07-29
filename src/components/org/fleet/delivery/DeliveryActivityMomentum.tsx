"use client";

// The "weekly avg / peak week / last 4 weeks" readout above DeliveryActivityChart — extracted so
// that file stays under the 200-LOC cap (AGENTS.md).

import { deltaHex } from "@/components/ui";
import { fmtWeek } from "./deliveryActivityChartMath";

export function DeliveryActivityMomentum({
  weeklyAvg,
  peakVal,
  peakWeekMs,
  last4,
  momentum,
}: {
  weeklyAvg: number;
  peakVal: number;
  peakWeekMs: number;
  last4: number;
  momentum: number | null;
}) {
  return (
    <div className="flex flex-wrap gap-x-8 gap-y-2">
      <div>
        <div className="font-mono text-xs uppercase tracking-[0.2em] text-slate-500">Weekly avg</div>
        <div className="mt-0.5 font-mono text-lg font-bold text-white">{weeklyAvg.toLocaleString()}</div>
      </div>
      <div>
        <div className="font-mono text-xs uppercase tracking-[0.2em] text-slate-500">Peak week</div>
        <div className="mt-0.5 font-mono text-lg font-bold text-white">
          {peakVal.toLocaleString()}
          <span className="ml-2 text-sm font-normal text-slate-500">{fmtWeek.format(peakWeekMs)}</span>
        </div>
      </div>
      <div>
        <div className="font-mono text-xs uppercase tracking-[0.2em] text-slate-500">Last 4 weeks</div>
        <div className="mt-0.5 font-mono text-lg font-bold text-white">
          {last4.toLocaleString()}
          {momentum != null && (
            <span className="ml-2 text-sm font-normal" style={{ color: deltaHex(momentum) }}>
              {momentum > 0 ? "▲" : momentum < 0 ? "▼" : "→"}
              {momentum > 0 ? "+" : ""}
              {momentum}% vs prior 4
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
