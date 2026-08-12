// The Delivery tab's trend-over-time section (G7-09) — the thing every sibling analytics surface
// already had and Delivery didn't. Server component: all the aggregation happened in
// `getOrgDeliveryTrend`; this only lays out the small multiples, the gated slope reads, and the
// honest statement of what is NOT measured.

import { Card, SectionHeader } from "@/components/org/shared/ui";
import { TimeRangeSelector } from "@/components/org/overview/TimeRangeSelector";
import { DIRECTION_TONE, deltaHex } from "@/components/ui";
import type { DeliveryMetricKey, DeliveryRateFit, OrgDeliveryTrend } from "@/lib/db/org-delivery-trend";
import type { RangeKey } from "@/lib/window";
import { DeliveryTrendPanel } from "./DeliveryTrendPanel";

interface MetricDef {
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
    help: "Share of PRs authored by an AI agent or carrying an AI marker. Not a target — context.",
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
    help: "Share of merged PRs whose commit messages carry an AI attribution trailer — grounded attribution, not self-declared. Context, not a target.",
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
    help: "Share of PRs at ≤ 200 changed lines — the batch size a reviewer can actually hold.",
    unit: "%",
  },
  {
    key: "revertRate",
    label: "Revert rate",
    help: "Share of PRs whose title starts with “Revert” — shipped work that had to come back out.",
    unit: "%",
    higherIsBetter: false,
  },
  {
    key: "hoursToFirstReview",
    label: "Time to first review",
    help: "Typical hours a PR waits for its first review — the review-capacity signal.",
    unit: "h",
    higherIsBetter: false,
  },
  {
    key: "hoursToMerge",
    label: "Time to merge",
    help: "Typical hours from a PR opening to it merging. Review latency — not deployment lead time.",
    unit: "h",
    higherIsBetter: false,
  },
];

/** Per-fit presentation: unit suffix + which direction is the GOOD news. Review latency (W1a) is a
 *  duration — its slope is hours/week, and a RISING line is the Assist→Delegate bottleneck forming,
 *  so its tone must invert while the arrow keeps reporting the true direction. */
const FIT_META: Partial<Record<DeliveryMetricKey, { label: string; suffix: string; higherIsBetter: boolean }>> = {
  reviewedRate: { label: "Review coverage trend", suffix: "pts/week", higherIsBetter: true },
  aiGovernedRate: { label: "AI review trend", suffix: "pts/week", higherIsBetter: true },
  hoursToFirstReview: { label: "Review latency trend", suffix: "h/week", higherIsBetter: false },
};

function FitReadout({ fit }: { fit: DeliveryRateFit }) {
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

export function DeliveryTrendSection({
  trend,
  range,
  from,
  to,
  periodTitle,
}: {
  trend: OrgDeliveryTrend;
  range: RangeKey;
  from?: string;
  to?: string;
  periodTitle: string;
}) {
  const anyMock = trend.points.some((p) => p.mock);

  return (
    <Card>
      <SectionHeader
        title="Delivery over time"
        description={`${periodTitle} — ${trend.scans} scan${trend.scans === 1 ? "" : "s"} across ${trend.repos} repo${
          trend.repos === 1 ? "" : "s"
        }. Each point is one day, aggregated over the scans that ran that day.`}
        right={<TimeRangeSelector range={range} from={from} to={to} />}
      />

      {/* Slope reads — the governance rates plus review latency (W1a), gated by the shared floor. */}
      <div className="mt-4 flex flex-wrap gap-x-10 gap-y-3">
        {trend.fits.map((f) => (
          <FitReadout key={f.metric} fit={f} />
        ))}
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {DELIVERY_TREND_METRICS.map((m) => (
          <DeliveryTrendPanel
            key={m.key}
            label={m.label}
            help={m.help}
            unit={m.unit}
            higherIsBetter={m.higherIsBetter}
            points={trend.points.map((p) => ({
              date: p.date,
              value: p[m.key],
              mock: p.mock,
              scans: p.scans,
              repos: p.repos,
            }))}
          />
        ))}
      </div>

      <div className="mt-4 space-y-2 font-mono text-sm text-slate-600">
        <p>
          A day&apos;s point describes the repos scanned that day, not the whole fleet — hover any point for its
          sample size. Days nobody measured a metric are gaps in the line, never zeroes.
        </p>
        {anyMock && (
          <p>Hollow points are days whose scans all came from the demo engine — a deterministic rubric, no model.</p>
        )}
        {trend.retentionClamped && trend.since && (
          <p>History starts {trend.since.slice(0, 10)} — your plan&apos;s retention window, not the period you picked.</p>
        )}
        {/* G7-10, answered honestly rather than by approximation. Time-to-merge is review latency, not
            DORA "lead time for changes" (commit → running in production); the other three DORA metrics
            need a deploy feed and an incident feed, neither of which Ascent ingests. Naming any of
            these "DORA" would invite a leader to benchmark a proxy against published industry figures. */}
        <p>
          These are git and GitHub delivery signals. They are deliberately <span className="text-slate-500">not</span>{" "}
          labelled DORA: deployment frequency and time-to-restore need a deployment and an incident feed that Ascent
          does not ingest, and &ldquo;time to merge&rdquo; is review latency, not lead time to production.
        </p>
      </div>
    </Card>
  );
}
