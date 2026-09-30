// Page statement for Prism. One figure row, paper numbers, status as a glyph on the figure.
// An empty fleet gets the real empty sentence and a single void, not four identical zeroes.
import type { ReactNode } from "react";
import { Masthead, type MastheadFigure } from "@/components/kit";
import { fmtMoney } from "./ai/aiDeliveryModel";
import { deliveryEmptyMessage } from "./deliveryLoad";
import { derivePriorities } from "./derivePriorities";
import { REVIEW_TARGET } from "./PrSignalsBand";
import { coverageTone, fullTone, hoursLabel, Unknown } from "./deliveryV2Marks";
import type { DeliveryCoreViewProps } from "./deliveryCoreView";

// Same bar as SLOW_MERGE_HOURS in derivePriorities.ts. Not exported there; kept in step by this comment.
const SLOW_MERGE_HOURS = 48;

function spendFigure(v: DeliveryCoreViewProps): MastheadFigure {
  if (v.spendKind === "unavailable") {
    return { label: "AI spend", value: <Unknown label="could not be read" subject="AI spend" /> };
  }
  if (v.withholdAllocatedRoi) {
    return {
      label: "AI spend",
      value: "Withheld",
      detail: "whole-org total under a filter",
      title: "Allocated spend has no per-repo breakdown. Clear the filter to see it.",
    };
  }
  if (v.spendKind === "present" && !v.aiModel) {
    return { label: "AI spend", value: <Unknown label="not measured" subject="AI spend" />, detail: "no pull requests to join" };
  }
  if (!v.aiModel || v.aiModel.fidelity === "none") {
    return {
      label: "AI spend",
      value: <Unknown label="no cost source" subject="AI spend" />,
      detail: "connect a provider",
    };
  }
  const s = v.aiModel.summary;
  const hot = s.idleSpend > 0 || s.ungovernedSpend > 0;
  return {
    label: "AI spend",
    value: fmtMoney(s.totalMonthlySpend),
    detail: "per month",
    tone: hot ? "risk" : undefined,
    title: hot ? "Idle or ungoverned spend is in this total." : "Connected spend for the month.",
  };
}

function figures(v: DeliveryCoreViewProps): MastheadFigure[] {
  const out: MastheadFigure[] = [];
  if (v.pr) {
    const rate = v.pr.avgReviewedRate;
    out.push({
      label: "Review coverage",
      value: rate == null ? <Unknown subject="review coverage" /> : `${rate}%`,
      tone: coverageTone(rate, REVIEW_TARGET),
      detail: rate == null ? "no human merges" : `target ${REVIEW_TARGET}%`,
    });
    const hours = v.pr.typicalHoursToMerge;
    out.push({
      label: "Merge time",
      value: hoursLabel(hours) ?? <Unknown subject="merge time" />,
      tone: hours != null && hours > SLOW_MERGE_HOURS ? "watch" : undefined,
      detail: "per-repo median",
    });
  }
  if (v.gov) {
    out.push({
      label: "Protected main",
      value: `${v.gov.protectedRate}%`,
      tone: fullTone(v.gov.protectedRate),
    });
  }
  if (v.activity && !v.pr) {
    out.push({
      label: "Commits",
      value: v.activity.total.toLocaleString(),
      detail: `${v.activity.repos} repo${v.activity.repos === 1 ? "" : "s"}`,
    });
  }
  if (v.pr || v.spendKind !== "none" || v.withholdAllocatedRoi) out.push(spendFigure(v));
  return out;
}

function headline(v: DeliveryCoreViewProps): { statement: string; named: string } {
  if (v.pr || v.gov) {
    const n = derivePriorities(v.pr, v.gov).length;
    return n === 0
      ? { statement: "No delivery red flags.", named: "The fleet clears the bar." }
      : { statement: `${n} delivery action${n === 1 ? "" : "s"}`, named: "to take first." };
  }
  return { statement: "Commit activity", named: "is the signal in this window." };
}

export function DeliveryMastheadV2(v: DeliveryCoreViewProps) {
  const aside: ReactNode = v.segmentBar;
  if (!v.pr && !v.gov && !v.activity) {
    const anyFailed = v.prFailed || v.govFailed || v.activityFailed;
    const lede = deliveryEmptyMessage({ anyFailed, segmentId: v.segmentId, techGroupId: v.techGroupId });
    const named = anyFailed ? "Try refreshing." : v.segmentId || v.techGroupId ? "This filter is empty." : "A GitHub token is required.";
    const statement = anyFailed ? "Delivery data couldn't load." : v.segmentId || v.techGroupId ? "No delivery signals" : "Nothing is measured yet.";
    return (
      <Masthead
        eyebrow="Delivery"
        statement={statement}
        named={named}
        lede={lede}
        aside={aside}
        pattern="spectral"
        figures={[{ label: "Fleet signals", value: <Unknown subject="fleet signals" /> }]}
      />
    );
  }
  const head = headline(v);
  return (
    <Masthead
      eyebrow="Delivery"
      statement={head.statement}
      named={head.named}
      aside={aside}
      pattern="spectral"
      figures={figures(v)}
    />
  );
}
