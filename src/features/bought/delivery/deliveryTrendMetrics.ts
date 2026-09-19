// The metric catalogue behind the Delivery tab's trend section (G7-09), split out of
// DeliveryTrendSection.tsx to keep that file inside the 200-line cap. Data only — no JSX, so it is
// safe on either side of the client boundary. Re-exported from ./DeliveryTrendSection.

import type { DeliveryMetricKey } from "@/lib/db/org-delivery-trend";

export interface MetricDef {
  key: DeliveryMetricKey;
  label: string;
  help: string;
  unit: "%" | "h";
  higherIsBetter?: boolean;
}

/**
 * What the trend shows, in the order a leader reads it: governance of review first (the control),
 * then AI involvement and whether it is governed, then the flow metrics. Every metric carries its own
 * one-line definition — an unexplained percentage on a leadership dashboard is an invitation to
 * misread it.
 */
export const DELIVERY_TREND_METRICS: MetricDef[] = [
  {
    key: "reviewedRate",
    label: "Review coverage",
    help: "Share of merged human-authored PRs that carried an approving review.",
    unit: "%",
  },
  {
    key: "aiInvolvedRate",
    label: "AI involvement",
    help: "Share of PRs authored by an AI agent or carrying an AI marker. Not a target, just context.",
    unit: "%",
  },
  {
    key: "aiGovernedRate",
    label: "AI PRs reviewed",
    help: "Share of AI-involved PRs that got an approving review before merge.",
    unit: "%",
  },
  {
    key: "aiTrailerRate",
    label: "AI trailers",
    help: "Share of merged PRs whose commit messages carry an AI attribution trailer (grounded attribution, not self-declared). Context, not a target.",
    unit: "%",
  },
  {
    key: "aiPreReviewedRate",
    label: "AI pre-review",
    help: "Share of merged PRs an AI/bot reviewer looked at before the first human review.",
    unit: "%",
  },
  {
    key: "protectedRate",
    label: "Protected default branch",
    help: "Share of repos with a protected default branch, among those whose rules Ascent could read.",
    unit: "%",
  },
  {
    key: "mergeRate",
    label: "Merge rate",
    help: "Of PRs that closed, the share that merged rather than being abandoned.",
    unit: "%",
  },
  {
    key: "smallPrRate",
    label: "Small PRs",
    help: "Share of PRs at ≤ 200 changed lines: the batch size a reviewer can actually hold.",
    unit: "%",
  },
  {
    key: "revertRate",
    label: "Revert rate",
    help: "Share of PRs whose title starts with “Revert”: shipped work that had to come back out.",
    unit: "%",
    higherIsBetter: false,
  },
  {
    key: "hoursToFirstReview",
    label: "Time to first review",
    help: "Typical hours a PR waits for its first review: the review-capacity signal.",
    unit: "h",
    higherIsBetter: false,
  },
  {
    key: "hoursToMerge",
    label: "Time to merge",
    help: "Typical hours from a PR opening to it merging. Review latency, not deployment lead time.",
    unit: "h",
    higherIsBetter: false,
  },
];
