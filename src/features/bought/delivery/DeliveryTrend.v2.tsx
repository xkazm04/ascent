// Prism trend. The small multiples stay: kit Trend cannot draw a broken day or an hours axis.
import { Caption, Frame, SectionHead } from "@/components/kit";
import { WhyChip } from "@/components/org/viz";
import { TimeRangeSelector } from "@/features/standing/overview/TimeRangeSelector";
import type { OrgDeliveryTrend } from "@/lib/db/org-delivery-trend";
import type { RangeKey } from "@/lib/window";
import { FitReadoutV2 } from "./DeliveryFit.v2";
import { DeliveryTrendPanel } from "./DeliveryTrendPanel";
import { NAMING_HINT, SAMPLE_HINT } from "./DeliveryTrendLegend";
import { DELIVERY_TREND_METRICS } from "./deliveryTrendMetrics";

export function DeliveryTrendV2({
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
  const scans = `${trend.scans} scan${trend.scans === 1 ? "" : "s"}`;
  const repos = `${trend.repos} repo${trend.repos === 1 ? "" : "s"}`;
  return (
    <Frame>
      <SectionHead
        eyebrow="Trend"
        title="Delivery over time"
        named={scans}
        lede={`${periodTitle} · ${repos} · 1 pt/day`}
        actions={<TimeRangeSelector range={range} from={from} to={to} />}
      />
      <div className="mt-6 flex flex-wrap gap-x-10 gap-y-4">
        {trend.fits.map((f) => (
          <FitReadoutV2 key={f.metric} fit={f} />
        ))}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        {anyVoid && <Caption>Gaps are unmeasured days, not zeroes.</Caption>}
        {anyMock && <Caption>Demo engine. Hollow points are demo-engine days.</Caption>}
        <span className="inline-flex items-center gap-1.5 text-slate-400">
          Sample <WhyChip hint={SAMPLE_HINT} label="what one point covers" />
        </span>
        <span className="inline-flex items-center gap-1.5 text-slate-400">
          Not DORA <WhyChip hint={NAMING_HINT} label="why these are not called DORA" />
        </span>
      </div>
      <div className="mt-4 grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
        {DELIVERY_TREND_METRICS.map((m) => (
          <DeliveryTrendPanel
            key={m.key}
            plain
            label={m.label}
            help={m.help}
            unit={m.unit}
            higherIsBetter={m.higherIsBetter}
            points={trend.points.map((p) => ({ date: p.date, value: p[m.key], mock: p.mock, scans: p.scans, repos: p.repos }))}
          />
        ))}
      </div>
      {trend.retentionClamped && trend.since && (
        <Caption className="mt-3">history from {trend.since.slice(0, 10)} · plan retention, not the period picked</Caption>
      )}
    </Frame>
  );
}
