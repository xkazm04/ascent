// The slope reads at the top of the Delivery trend section — one per fitted metric. Split out of
// DeliveryTrendSection.tsx (200-line cap). Server component: no hooks, no handlers.
//
// Each readout now LEADS with its shape (`DeliverySlopeMark`), so the first thing under the section
// header is a row of angles rather than a row of sentences, and a fit that the shared insufficiency
// gate refuses to state is drawn HATCHED with no numeral instead of explaining itself in prose. The
// refusal sentence itself moves into the mark's `WhyChip` (§2.1 D — Disclosed).

import { DIRECTION_TONE, deltaHex } from "@/components/ui";
import { WhyChip } from "@/components/org/viz";
import { DeliverySlopeMark } from "./DeliverySlopeMark";
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
  // mark is hatched and prints nothing; the gate's own sentence — the same one the trends page and
  // the org rollup show — rides the WhyChip rather than standing beside the confident fits.
  if (fit.insufficiency) {
    return (
      <div className="min-w-0">
        <div className="flex items-center gap-1.5 type-mono-sm uppercase tracking-widest text-slate-500">
          {meta.label}
          <WhyChip hint={fit.insufficiency} label={`${meta.label}, not judged`} />
        </div>
        <div className="mt-1">
          <DeliverySlopeMark perWeek={0} state="not-judged" subject={meta.label} />
        </div>
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
      <div className="type-mono-sm uppercase tracking-widest text-slate-500">{meta.label}</div>
      <div className="mt-1 flex items-center gap-2">
        {/* The ANGLE is the true slope — a falling latency line falls on screen. Only the COLOUR is
            goodness-signed, so the mark can be lime and still point down. */}
        <DeliverySlopeMark perWeek={fit.perWeek} state="measured" subject={meta.label} color={color} />
        <span className="font-mono type-body" style={{ color }}>
          <span aria-hidden>{arrow}</span> {fit.perWeek > 0 ? "+" : ""}
          {fit.perWeek} {meta.suffix}
        </span>
      </div>
      <div className="type-mono-sm text-slate-600">
        fit over {fit.points} days · {fit.spanDays}d span
      </div>
    </div>
  );
}
