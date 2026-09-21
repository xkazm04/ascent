// ONE ARM, carrying its own contract: the headline metric with its direction, both cost views, both
// reliability figures, and every outcome — including the ones that are usually dropped.
//
// Pure rendering (no hooks, no handlers) so it stays a server component and a DOM test can render
// every state from a fixture.

import { Kicker } from "@/components/ui";
import type { ArmResult } from "@/lib/local/compare-metrics";
import {
  BELOW_FLOOR_NOTE,
  MODELLED_NOTE,
  OPTIMIZED_DIRECTION,
  fmtCost,
  fmtInt,
  fmtMetric,
  fmtRate,
  outcomeRows,
  populationLine,
  reliabilityLines,
  subsetLine,
} from "./comparisonFormat";

const OUTCOME_TONE: Record<string, string> = {
  landed: "text-success-soft",
  failed: "text-danger",
  voided: "text-amber-300",
  parked: "text-amber-300",
  timedOut: "text-warn",
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 border-t border-divider pt-3">
      <Kicker tone="muted">{label}</Kicker>
      {children}
    </div>
  );
}

export function ComparisonArm({
  arm,
  advanced,
  /** Arms are still running: the optimized metric is not final, so no provisional headline. */
  pending = false,
}: {
  arm: ArmResult;
  advanced: boolean;
  pending?: boolean;
}) {
  const rel = arm.reliability;
  return (
    <article
      data-testid="comparison-arm"
      data-arm={arm.armId}
      data-below-floor={arm.belowFloor || undefined}
      aria-label={`Arm ${arm.label}`}
      className="flex min-w-0 flex-col gap-3 bg-ink px-5 py-4"
    >
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h4 className="min-w-0 break-words type-title font-semibold text-white">{arm.label}</h4>
        {advanced ? (
          <span className="rounded bg-accent/15 px-2 py-0.5 font-mono type-caption uppercase tracking-widest text-accent">Advances</span>
        ) : null}
        {arm.belowFloor ? (
          <span data-testid="comparison-below-floor" title={BELOW_FLOOR_NOTE} className="rounded bg-amber-500/10 px-2 py-0.5 font-mono type-caption uppercase tracking-widest text-amber-300">
            Below floor
          </span>
        ) : null}
      </header>

      <div className="flex flex-col gap-1">
        <Kicker tone="accent">Claude tokens per verified point · {OPTIMIZED_DIRECTION}</Kicker>
        {pending ? (
          <p data-testid="comparison-metric-pending" className="type-title text-slate-400">
            Still running — the metric is not final
          </p>
        ) : (
          <p data-testid="comparison-metric" className="font-mono type-figure-lg tabular-nums text-white">
            {fmtMetric(arm.claudeTokensPerVerifiedPoint)}
            {arm.claudeTokensPerVerifiedPoint == null ? (
              <span className="ml-3 type-body-sm font-sans text-slate-400">no verified points — not a zero</span>
            ) : null}
          </p>
        )}
        <p className="type-caption text-slate-500">
          <span className="font-mono tabular-nums">{fmtInt(arm.verifiedPoints)}</span> verified points ·{" "}
          <span className="font-mono tabular-nums">{fmtInt(arm.claudeTokens)}</span> Claude tokens ·{" "}
          <span className="font-mono tabular-nums">{fmtInt(arm.localTokens)}</span> local tokens
        </p>
      </div>

      <Row label="Cost · all completed">
        <p className="font-mono type-mono-sm tabular-nums text-white">{fmtCost(arm.costAllCompleted)}</p>
        <p data-testid="comparison-cost-all-population" className="type-caption text-slate-500">
          {populationLine(arm.costAllCompleted)}
        </p>
      </Row>

      <Row label="Cost · conditioned">
        <p className="font-mono type-mono-sm tabular-nums text-white">{fmtCost(arm.costConditioned)}</p>
        <p data-testid="comparison-cost-conditioned-subset" className="type-caption text-slate-500">
          {subsetLine(arm.costConditioned, arm.costAllCompleted)}
        </p>
      </Row>

      <Row label="Reliability">
        <dl className="flex flex-wrap gap-x-8 gap-y-2">
          {reliabilityLines(rel).map((line) => (
            <div key={line.key} data-testid={`comparison-reliability-${line.key}`} className="flex flex-col">
              <dt className="type-caption text-slate-500" title={line.about}>
                {line.label}
              </dt>
              <dd className="font-mono type-mono-sm tabular-nums text-white">{line.value}</dd>
            </div>
          ))}
        </dl>
        <p className="type-caption text-slate-500">
          per trial <span className="font-mono tabular-nums text-slate-300">{fmtRate(rel.perTrial.value)}</span> over{" "}
          <span className="font-mono tabular-nums">{fmtInt(rel.perTrial.n)}</span> — {rel.perTrial.predicate}
        </p>
        {rel.modelled ? (
          <p data-testid="comparison-reliability-modelled" title={MODELLED_NOTE} className="w-fit rounded bg-amber-500/10 px-2 py-0.5 font-mono type-caption uppercase tracking-widest text-amber-300">
            Modelled, not observed
          </p>
        ) : (
          <p className="type-caption text-slate-500">Observed from the trials that ran.</p>
        )}
      </Row>

      <Row label="Outcomes">
        <ul className="flex flex-col gap-1.5">
          {outcomeRows(arm).map((o) => (
            <li key={o.key} data-testid={`comparison-outcome-${o.key}`} className="flex items-baseline gap-3 type-body-sm">
              <span className={`w-10 shrink-0 text-right font-mono tabular-nums ${OUTCOME_TONE[o.key] ?? "text-slate-300"}`}>{fmtInt(o.count)}</span>
              <span className="text-slate-300">{o.label}</span>
              <span className="min-w-0 type-caption text-slate-500">{o.reason}</span>
            </li>
          ))}
        </ul>
      </Row>
    </article>
  );
}
