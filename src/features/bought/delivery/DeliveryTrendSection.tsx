// The Delivery tab's trend-over-time section (G7-09) — the thing every sibling analytics surface
// already had and Delivery didn't. Server component: all the aggregation happened in
// `getOrgDeliveryTrend`; this only lays out the small multiples, the gated slope reads, and the
// honest statement of what is NOT measured.

import { Card, SectionHeader } from "@/components/org/shared/ui";
import { TimeRangeSelector } from "@/features/standing/overview/TimeRangeSelector";
import type { OrgDeliveryTrend } from "@/lib/db/org-delivery-trend";
import type { RangeKey } from "@/lib/window";
import { DeliveryTrendPanel } from "./DeliveryTrendPanel";
import { FitReadout } from "./DeliveryFitReadout";
import { DELIVERY_TREND_METRICS } from "./deliveryTrendMetrics";

// The metric catalogue and the per-fit slope readout live in co-located siblings (200-line cap).
// DELIVERY_TREND_METRICS is re-exported here so this file stays its import path.
export { DELIVERY_TREND_METRICS } from "./deliveryTrendMetrics";

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
        description={`${periodTitle}: ${trend.scans} scan${trend.scans === 1 ? "" : "s"} across ${trend.repos} repo${
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
          A day&apos;s point describes the repos scanned that day, not the whole fleet. Hover any point for its
          sample size. Days nobody measured a metric are gaps in the line, never zeroes.
        </p>
        {anyMock && (
          <p>Hollow points are days whose scans all came from the demo engine (a deterministic rubric, no model).</p>
        )}
        {trend.retentionClamped && trend.since && (
          <p>History starts {trend.since.slice(0, 10)}: your plan&apos;s retention window, not the period you picked.</p>
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
