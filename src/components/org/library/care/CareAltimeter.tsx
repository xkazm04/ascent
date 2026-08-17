"use client";

// The habits altimeter (Climb variant). Each shared session-shape field is read as ALTITUDE: how high
// the habit currently sits inside the org's own interquartile band. It is the `.strata` motif applied
// to habits rather than repositories — the same "elevation" language the product uses for the climb.
//
// A field the developer did not share has no needle. That gap is drawn as a dashed rung rather than
// omitted, so the instrument reads as "you chose not to send this", not as "you score zero".

import { CARE_SHAPE_LABEL, CARE_SHAPE_ORDER, CARE_SHAPE_HIGHER_IS_BETTER, careShapeValue, type CarePersonalView } from "@/lib/org/care-view";

/** Altitude 0–100: where `value` sits between p25 and p75, clamped, flipped for "lower is better". */
function altitude(value: number, band: { p25: number; p50: number; p75: number }, higherIsBetter: boolean): number {
  const lo = Math.min(band.p25, band.p75);
  const hi = Math.max(band.p25, band.p75);
  const raw = hi === lo ? 50 : ((value - lo) / (hi - lo)) * 100;
  const clamped = Math.max(0, Math.min(100, raw));
  return higherIsBetter ? clamped : 100 - clamped;
}

export function CareAltimeter({ personal }: { personal: CarePersonalView }) {
  const shared = new Set(personal.sharedFields);
  const rungs = CARE_SHAPE_ORDER.map((field) => {
    const value = shared.has(field) ? personal.shape[field] : null;
    const band = personal.orgBands?.[field];
    const alt = value != null && band ? altitude(value, band, CARE_SHAPE_HIGHER_IS_BETTER.has(field)) : null;
    return { field, value, band, alt };
  });

  return (
    <div className="mt-3 rounded-2xl border border-divider bg-surface-strong/40 p-4">
      <div className="strata grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {rungs.map(({ field, value, band, alt }) => (
          <div key={field} className="flex items-end gap-3">
            {/* The vertical gauge: 0 at the bottom, the org's upper quartile at the top. */}
            <div className="relative h-24 w-2 shrink-0 overflow-hidden rounded-full bg-slate-800" aria-hidden>
              {alt == null ? (
                <div className="absolute inset-0 border-l border-dashed border-slate-700" />
              ) : (
                <div className="absolute inset-x-0 bottom-0 rounded-full bg-accent" style={{ height: `${alt}%` }} />
              )}
              {band ? <div className="absolute inset-x-0 h-px bg-slate-500" style={{ bottom: "50%" }} /> : null}
            </div>
            <div className="min-w-0">
              <div className="font-mono text-xs uppercase tracking-[0.18em] text-slate-400">{CARE_SHAPE_LABEL[field]}</div>
              <div className="mt-0.5 font-mono text-xl font-bold tabular-nums text-white">
                {value == null ? <span className="text-slate-700">—</span> : careShapeValue(field, value)}
              </div>
              <div className="text-sm text-slate-500">
                {value == null
                  ? "not shared"
                  : band
                    ? `${Math.round(alt ?? 0)}% up the org band`
                    : "no band — comparison is opt-in"}
              </div>
            </div>
          </div>
        ))}
      </div>
      <p className="mt-4 text-sm text-slate-500">
        Altitude is your position inside the org&apos;s interquartile band, not a score. The mid-rule is the median. Everything
        here is a count you chose to send.
      </p>
    </div>
  );
}
