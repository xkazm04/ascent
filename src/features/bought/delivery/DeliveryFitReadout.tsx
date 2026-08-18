// The slope reads at the top of the Delivery trend section — one per fitted metric. Split out of
// DeliveryTrendSection.tsx (200-line cap). Server component: no hooks, no handlers.

import { DIRECTION_TONE, deltaHex } from "@/components/ui";
import type { DeliveryMetricKey, DeliveryRateFit } from "@/lib/db/org-delivery-trend";

/** Per-fit presentation: unit suffix + which direction is the GOOD news. Review latency (W1a) is a
 *  duration — its slope is hours/week, and a RISING line is the Assist→Delegate bottleneck forming,
 *  so its tone must invert while the arrow keeps reporting the true direction. */
const FIT_META: Partial<Record<DeliveryMetricKey, { label: string; suffix: string; higherIsBetter: boolean }>> = {
  reviewedRate: { label: "Review coverage trend", suffix: "pts/week", higherIsBetter: true },
  aiGovernedRate: { label: "AI review trend", suffix: "pts/week", higherIsBetter: true },
  hoursToFirstReview: { label: "Review latency trend", suffix: "h/week", higherIsBetter: false },
};

export function FitReadout({ fit }: { fit: DeliveryRateFit }) {
  const meta = FIT_META[fit.metric] ?? { label: fit.metric, suffix: "pts/week", higherIsBetter: true };
  // The shared insufficiency gate decides whether a slope may be SHOWN AT ALL. Below the floor the
  // copy from `forecastInsufficiency` is rendered verbatim — the same sentence the trends page and
  // the org rollup show — instead of a confident "+3.2/wk" read off four days of noise.
  if (fit.insufficiency) {
    return (
      <div className="min-w-0">
        <div className="font-mono text-sm uppercase tracking-widest text-slate-500">{meta.label}</div>
        <div className="mt-0.5 text-sm text-slate-500">{fit.insufficiency}</div>
      </div>
    );
  }
  // Arrow = the true direction of the line; color = whether that direction is good. deltaHex over the
  // goodness-signed slope (the DeliveryTrendPanel idiom) keeps a falling review-latency line lime and
  // a rising one orange, without lying about which way it moves.
  const arrow = DIRECTION_TONE[fit.trajectory].arrow;
  const color = deltaHex(meta.higherIsBetter ? fit.perWeek : -fit.perWeek);
  return (
    <div className="min-w-0">
      <div className="font-mono text-sm uppercase tracking-widest text-slate-500">{meta.label}</div>
      <div className="mt-0.5 font-mono text-base" style={{ color }}>
        <span aria-hidden>{arrow}</span> {fit.perWeek > 0 ? "+" : ""}
        {fit.perWeek} {meta.suffix}
      </div>
      <div className="font-mono text-sm text-slate-600">
        fit over {fit.points} days · {fit.spanDays}d span
      </div>
    </div>
  );
}
