// The widest gaps the fleet shares — drawn, not narrated.
//
// This panel used to open with the sentence that described its own ranking ("ranked by reach × impact
// × dimension weight, with the engine-true maturity each repo stands to gain … Somewhere to look
// next, not an order"), then rendered a numbered list with a highlighted "Explore first" pill. Both
// halves are gone: the ranking is the bar (LeverageBars, on one shared scale), the basis is a
// WhyChip, and the restraint is the absence of rank numerals and CTA styling rather than a promise
// that the list is not an order. Server component; the caller passes a non-empty list.

import Link from "next/link";
import { SectionHeader } from "@/components/org/shared/ui";
import { Legend, WhyChip } from "@/components/org/viz";
import type { OrgRec } from "@/lib/db";
import { LeverageBars } from "./LeverageBars";
import {
  LEVERAGE_BASIS_HINT,
  LEVERAGE_ORDER_HINT,
  LEVERAGE_RUNG_HINT,
  leverageBars,
  leverageStates,
} from "./leverageMoves";

/** The rung tick at swatch scale — the legend paints the mark the chart draws, not an approximation. */
const RUNG_SWATCH = (
  <svg viewBox="0 0 10 10" width={10} height={10} aria-hidden className="shrink-0">
    <rect x={0} y={3} width={10} height={4} fill="var(--color-accent)" fillOpacity={0.7} />
    <line x1={6} y1={1} x2={6} y2={9} stroke="var(--color-accent)" strokeWidth={2} />
  </svg>
);

export function OrgLeverageMoves({ recs, slug }: { recs: OrgRec[]; slug: string }) {
  const bars = leverageBars(recs);
  const [top] = recs;
  return (
    <div>
      <SectionHeader
        title={
          <span className="inline-flex items-center gap-2">
            Widest shared gaps
            <WhyChip hint={LEVERAGE_BASIS_HINT} label="ranking basis" />
          </span>
        }
        right={
          <span className="inline-flex items-center gap-2 type-mono-sm uppercase tracking-widest text-slate-600">
            current state · not period-scoped
            <WhyChip hint={LEVERAGE_ORDER_HINT} label="how to read this list" align="end" />
          </span>
        }
      />

      <LeverageBars bars={bars} className="mt-3" />

      <Legend
        className="mt-2"
        states={leverageStates(bars)}
        extra={
          bars.some((b) => b.liftsRepos > 0)
            ? [{ id: "rung", label: "Crosses a level", swatch: RUNG_SWATCH, hint: LEVERAGE_RUNG_HINT }]
            : []
        }
      />

      {/* The companion voice that is genuinely CONTENT rather than chrome: why the widest gap matters,
          and a question to explore it with. Kept for the top gap only — the bars above already say
          which one that is, so this needs no pill, no numeral and no "Explore first" badge. */}
      {top && (top.rationale || top.explore[0]) && (
        <div className="mt-4 space-y-1.5 border-l border-divider pl-3">
          <div className="type-mono-sm uppercase tracking-widest text-slate-600">{top.title}</div>
          {top.rationale && <p className="type-body-sm text-slate-400">{top.rationale}</p>}
          {top.explore[0] && (
            <p className="flex gap-2 type-body-sm text-slate-300">
              <span className="select-none text-accent" aria-hidden>
                ?
              </span>
              <span>{top.explore[0]}</span>
            </p>
          )}
        </div>
      )}

      <Link
        href={`/org/${slug}/repositories`}
        className="mt-3 inline-block type-mono-sm uppercase tracking-widest text-accent hover:text-white"
      >
        Browse all repositories →
      </Link>
    </div>
  );
}
