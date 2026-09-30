// Slope readouts in paper. The arrow is the true direction. Health is a word, not a hue.
import { Caption } from "@/components/kit";
import { DIRECTION_TONE } from "@/components/ui";
import { WhyChip } from "@/components/org/viz";
import type { DeliveryMetricKey, DeliveryRateFit } from "@/lib/db/org-delivery-trend";
import { DeliverySlopeMark } from "./DeliverySlopeMark";

const FIT_META: Partial<Record<DeliveryMetricKey, { label: string; suffix: string; higherIsBetter: boolean }>> = {
  reviewedRate: { label: "Review coverage trend", suffix: "pts/week", higherIsBetter: true },
  aiGovernedRate: { label: "AI review trend", suffix: "pts/week", higherIsBetter: true },
  hoursToFirstReview: { label: "Review latency trend", suffix: "h/week", higherIsBetter: false },
};

export function FitReadoutV2({ fit }: { fit: DeliveryRateFit }) {
  const meta = FIT_META[fit.metric] ?? { label: fit.metric, suffix: "pts/week", higherIsBetter: true };
  if (fit.insufficiency) {
    return (
      <div className="min-w-0">
        <Caption>
          {meta.label} <WhyChip hint={fit.insufficiency} label={`${meta.label}, not judged`} />
        </Caption>
        <div className="mt-1">
          <DeliverySlopeMark perWeek={0} state="not-judged" subject={meta.label} />
        </div>
      </div>
    );
  }
  const dir = DIRECTION_TONE[fit.trajectory];
  const helpful = fit.trajectory === "flat" ? null : meta.higherIsBetter ? fit.trajectory === "rising" : fit.trajectory === "falling";
  const word = helpful == null ? "Holding" : helpful ? "Healthy" : "At risk";
  return (
    <div className="min-w-0">
      <Caption>{meta.label}</Caption>
      <div className="mt-1 flex items-center gap-2 text-white">
        <DeliverySlopeMark perWeek={fit.perWeek} state="measured" subject={meta.label} />
        <span className="tabular-nums">
          <span className="sr-only">{word}, {dir.label}: </span>
          <span aria-hidden>{dir.arrow} </span>
          {fit.perWeek > 0 ? "+" : ""}
          {fit.perWeek} {meta.suffix}
        </span>
      </div>
      <Caption>
        fit over {fit.points} days, {fit.spanDays}d span
      </Caption>
    </div>
  );
}
