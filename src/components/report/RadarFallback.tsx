"use client";

// The under-3-dimensions form for the maturity radar.
//
// A radar needs at least three axes to enclose an area. With n = 1 or 2 the angle/point math in
// RadarChart still produces perfectly valid coordinates — they just describe a single vertex or a
// zero-area line, so the polygon renders as an invisible shape while the data plainly exists. That
// is the worst of both worlds: the chart looks broken AND the numbers are unreadable. Reachable from
// any direct caller that can pass a shorter array (RoadmapSandbox projects a subset).
//
// Rather than fall through to the "No dimension data" placeholder (which would be a lie — there IS
// data), degrade to the honest form for one or two magnitudes: labeled bars. Same accessible
// contract as the radar — a named role="img" region, per-dimension score + level, and a real button
// per row when the chart is acting as a picker.

import type { DimensionId, DimensionResult } from "@/lib/types";
import { levelForScore } from "@/lib/maturity/model";
import { DIMENSION_SHORT, scoreHex } from "@/lib/ui";

export function RadarFallback({
  dimensions,
  highlightId = null,
  onSelect,
}: {
  dimensions: DimensionResult[];
  highlightId?: DimensionId | null;
  onSelect?: (id: DimensionId) => void;
}) {
  return (
    <div className="mx-auto w-full max-w-[340px]">
      <p className="text-sm text-slate-500">
        {dimensions.length === 1 ? "One dimension" : "Two dimensions"} scored — a radar needs three or
        more axes to describe a shape, so {dimensions.length === 1 ? "it is" : "they are"} shown as bars.
      </p>
      <ul className="mt-3 space-y-3">
        {dimensions.map((d) => {
          const lvl = levelForScore(d.score);
          const hi = d.id === highlightId;
          const label = (
            <>
              <span className={hi ? "font-semibold text-slate-100" : "text-slate-300"}>{DIMENSION_SHORT[d.id] ?? d.name}</span>
              <span className="sr-only"> {d.name}</span>
            </>
          );
          return (
            <li key={d.id}>
              <div className="flex items-baseline justify-between gap-2 text-sm">
                {onSelect ? (
                  <button type="button" className="text-left hover:text-white" onClick={() => onSelect(d.id)}>
                    {label}
                  </button>
                ) : (
                  <span>{label}</span>
                )}
                <span className="font-mono tabular-nums text-slate-400">
                  <span className="font-bold" style={{ color: scoreHex(d.score) }}>
                    {d.score}
                  </span>
                  /100 · {lvl.id} {lvl.name}
                </span>
              </div>
              {/* A zero renders as an empty track with an explicit "0" marker rather than a hairline
                  fill — the same principle the radar applies to a zero vertex (see RadarChart). */}
              <div
                className={`mt-1 h-2 w-full overflow-hidden rounded-full bg-slate-800 ${hi ? "ring-1 ring-accent" : ""}`}
                role="img"
                aria-label={`${d.name}: ${d.score} of 100, ${lvl.id} ${lvl.name}`}
              >
                {d.score > 0 && (
                  <div className="h-full rounded-full" style={{ width: `${d.score}%`, backgroundColor: scoreHex(d.score) }} />
                )}
              </div>
              {d.score === 0 && <div className="mt-0.5 text-sm text-slate-500">Zero — nothing detected for this dimension.</div>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
