"use client";

// The under-3-dimensions form for the maturity radar.
//
// A radar needs at least three axes to enclose an area. With n = 1 or 2 the angle/point math in
// RadarChart still produces perfectly valid coordinates — they just describe a single vertex or a
// zero-area line, so the polygon renders as an invisible shape while the data plainly exists. That
// is the worst of both worlds: the chart looks broken AND the numbers are unreadable. Reachable from
// a partial report: a failed detector drops its dimension before the blend (scoring/engine.ts), and
// RoadmapSandbox's projection maps report.dimensions one to one, so it draws what the scan kept.
//
// The radar's engine honesty carries over: a mock-scored report draws its bars hollow (surface fill,
// score-coloured inset edge, the waterfall's mark), names the demo scan to assistive tech, and shows
// the snapshot footnote. Mock is the report's engine, not a per-dimension fact (chartEngine.ts).
//
// Rather than fall through to the "No dimension data" placeholder (which would be a lie — there IS
// data), degrade to the honest form for one or two magnitudes: labeled bars. Same accessible
// contract as the radar — a named role="img" region, per-dimension score + level, and a real button
// per row when the chart is acting as a picker.

import type { DimensionId, DimensionResult } from "@/lib/types";
import { levelForScore } from "@/lib/maturity/model";
import { DIMENSION_SHORT, scoreHex } from "@/lib/ui";
import {
  MOCK_HOLLOW_FILL,
  MOCK_SNAPSHOT_NOTE,
  MOCK_SR_SUFFIX,
  isMockEngine,
  mockHollowInset,
} from "@/components/report/chartEngine";

export function RadarFallback({
  dimensions,
  highlightId = null,
  onSelect,
  engine,
}: {
  dimensions: DimensionResult[];
  highlightId?: DimensionId | null;
  onSelect?: (id: DimensionId) => void;
  /** Scan engine provider, forwarded by RadarChart. A mock-scored report draws its bars hollow. */
  engine?: string | null;
}) {
  const mock = isMockEngine(engine);
  return (
    <div className="mx-auto w-full max-w-[340px]">
      <p className="type-body-sm text-slate-500">
        {dimensions.length === 1 ? "One dimension" : "Two dimensions"} scored. A radar needs three or
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
              <div className="flex items-baseline justify-between gap-2 type-body-sm">
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
                aria-label={`${d.name}: ${d.score} of 100, ${lvl.id} ${lvl.name}${mock ? MOCK_SR_SUFFIX : ""}`}
              >
                {d.score > 0 && (
                  <div
                    className="h-full rounded-full"
                    data-mock={mock ? "" : undefined}
                    style={
                      mock
                        ? { width: `${d.score}%`, backgroundColor: MOCK_HOLLOW_FILL, boxShadow: mockHollowInset(scoreHex(d.score)) }
                        : { width: `${d.score}%`, backgroundColor: scoreHex(d.score) }
                    }
                  />
                )}
              </div>
              {d.score === 0 && <div className="mt-0.5 type-body-sm text-slate-500">Zero: nothing detected for this dimension.</div>}
            </li>
          );
        })}
      </ul>
      {mock && <p className="mt-3 type-body-sm text-slate-500">{MOCK_SNAPSHOT_NOTE}</p>}
    </div>
  );
}
