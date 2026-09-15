// The Delivery tab's trend-over-time section (G7-09) — the thing every sibling analytics surface
// already had and Delivery didn't. Server component: all the aggregation happened in
// `getOrgDeliveryTrend`; this only lays out the slope marks, the small multiples, and the LEGEND that
// now carries what used to be a four-paragraph footnote.
//
// THE SENTENCE THIS SECTION EXISTS TO STOP NEEDING. "An em dash is a missing measurement, not a zero"
// was the most load-bearing caveat on the tab and the one prose could never enforce — nothing stops a
// reader from reading a dash as a zero. Every line here now BREAKS at an unmeasured day
// (`trendPath`), every panel counts its void days, and the legend shows the void as a symbol with the
// canonical hint on it. The reader cannot mistake absence for zero because the picture does not offer
// a zero to mistake (docs/ORG-UX-REDESIGN.md §2.4).

import { Card, SectionHeader } from "@/components/org/shared/ui";
import { Legend, WhyChip } from "@/components/org/viz";
import { TimeRangeSelector } from "@/features/standing/overview/TimeRangeSelector";
import type { OrgDeliveryTrend } from "@/lib/db/org-delivery-trend";
import type { RangeKey } from "@/lib/window";
import { DeliveryTrendPanel } from "./DeliveryTrendPanel";
import { FitReadout } from "./DeliveryFitReadout";
import { DELIVERY_TREND_METRICS } from "./deliveryTrendMetrics";
import { MockPointSwatch, NAMING_HINT, SAMPLE_HINT } from "./DeliveryTrendLegend";

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
  const anyVoid = trend.points.some((p) => DELIVERY_TREND_METRICS.some((m) => p[m.key] == null));

  return (
    <Card>
      {/* §2.3 — a header is a noun phrase; the description states unit and window, nothing else. */}
      <SectionHeader
        title="Delivery over time"
        description={`${periodTitle} · ${trend.scans} scan${trend.scans === 1 ? "" : "s"} · ${trend.repos} repo${
          trend.repos === 1 ? "" : "s"
        } · 1 pt/day`}
        right={<TimeRangeSelector range={range} from={from} to={to} />}
      />

      {/* First sight is graphical: a row of slope marks, one per gated fit. */}
      <div className="mt-4 flex flex-wrap gap-x-10 gap-y-3">
        {trend.fits.map((f) => (
          <FitReadout key={f.metric} fit={f} />
        ))}
      </div>

      {/* The legend is where the demoted caveats live: one symbol per encoding actually on screen,
          each carrying its sentence on hover/focus. */}
      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        <Legend
          states={anyVoid ? ["measured", "missing"] : ["measured"]}
          extra={anyMock ? [{ id: "mock", label: "Demo engine", swatch: <MockPointSwatch />, hint: "A day whose scans all came from the deterministic demo rubric — no model graded it, so it is not comparable to a live-scored day." }] : []}
        />
        <span className="flex items-center gap-1.5 type-mono-sm text-slate-600">
          sample
          <WhyChip hint={SAMPLE_HINT} label="what one point covers" />
        </span>
        <span className="flex items-center gap-1.5 type-mono-sm text-slate-600">
          not DORA
          <WhyChip hint={NAMING_HINT} label="why these are not called DORA" />
        </span>
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

      {/* Not a caveat about an encoding — a fact about THIS render's x-axis domain, which no symbol
          can carry, so it stays on screen as one compact line. */}
      {trend.retentionClamped && trend.since && (
        <p className="mt-3 type-mono-sm text-slate-600">
          history from {trend.since.slice(0, 10)} · plan retention, not the period picked
        </p>
      )}
    </Card>
  );
}
