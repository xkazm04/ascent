// The footer of one Delivery trend small multiple: the period delta, the measured/unmeasured day
// counts, and the sr-only value list. Extracted from DeliveryTrendPanel for the 200-LOC cap.
//
// The unmeasured-day count is rendered as a real reading rather than a caveat: a panel whose line has
// four breaks in it says "7 measured · 4 no measurement" beside the delta, so the absence has a
// number of its own instead of being something the reader must infer from the picture.
// Server-safe — no hooks, no handlers.

import { deltaHex, fmtDelta } from "@/components/ui";
import { STATE_LABEL } from "@/components/org/viz";
import { dayLabel, type TrendPanelPoint } from "./deliveryTrendPanelMath";

export function DeliveryTrendPanelFoot({
  label,
  fmt,
  present,
  delta,
  toneValue,
  unit,
  voids,
}: {
  label: string;
  fmt: (v: number) => string;
  present: (TrendPanelPoint & { value: number; i: number })[];
  delta: number | null;
  toneValue: number;
  unit: "%" | "h";
  voids: number;
}) {
  return (
    <>
      <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-3 type-mono-sm">
        {delta === null ? (
          <span className="text-slate-500">one measured day: no change to read</span>
        ) : (
          <span style={{ color: deltaHex(toneValue) }}>
            {fmtDelta(delta)}
            {unit === "%" ? "pts" : "h"} across the period
          </span>
        )}
        <span className="text-slate-600">
          {present.length} measured
          {voids > 0 && (
            <>
              {" · "}
              <span title={`${voids} day${voids === 1 ? "" : "s"}: ${STATE_LABEL.missing.toLowerCase()}, drawn as a gap and never as a zero`}>
                {voids} no measurement
              </span>
            </>
          )}
        </span>
      </div>

      {/* Every value reachable without a pointer (and for assistive tech / print). */}
      <ul className="sr-only">
        {present.map((p) => (
          <li key={p.i}>
            {label} {fmt(p.value)} on {dayLabel(p.date)} from {p.scans} scan{p.scans === 1 ? "" : "s"}
            {p.mock ? " (demo scans only: deterministic rubric, no model)" : ""}
          </li>
        ))}
        {voids > 0 && (
          <li>
            {voids} day{voids === 1 ? "" : "s"} in this period have no {label.toLowerCase()} measurement: the line is
            broken there, and no value is claimed.
          </li>
        )}
      </ul>
    </>
  );
}
