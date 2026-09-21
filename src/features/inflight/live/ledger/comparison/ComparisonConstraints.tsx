// THE DECLARED THRESHOLDS — every constraint, with the threshold it was declared at, the observation,
// and one of three words: CLEARED, BREACHED, UNMEASURED.
//
// The third word is the reason this is a component rather than two columns: a constraint with no
// observation is not cleared, and the only rendering that makes that impossible to misread is one
// where "unmeasured" is as loud as "breached".

import { Kicker } from "@/components/ui";
import type { ConstraintVerdict } from "@/lib/local/compare-metrics";
import { CONSTRAINT_WORD, constraintBound, constraintState, type ConstraintState } from "./comparisonFormat";

const TONE: Record<ConstraintState, string> = {
  cleared: "text-success-soft",
  breached: "text-danger",
  unmeasured: "text-amber-300",
};

export function ComparisonConstraints({ verdicts }: { verdicts: readonly ConstraintVerdict[] }) {
  if (verdicts.length === 0) {
    return (
      <p data-testid="comparison-constraints-empty" className="type-body-sm text-slate-400">
        This comparison declared no constraints — the optimized metric stands alone.
      </p>
    );
  }
  return (
    <ul data-testid="comparison-constraints" className="flex flex-col gap-px bg-divider">
      {verdicts.map((v) => {
        const state = constraintState(v);
        return (
          <li
            key={v.constraint.id}
            data-testid="comparison-constraint"
            data-constraint={v.constraint.id}
            data-state={state}
            className="flex flex-wrap items-baseline gap-x-4 gap-y-1 bg-ink px-4 py-3"
          >
            <span className={`w-28 shrink-0 font-mono type-caption uppercase tracking-widest ${TONE[state]}`}>{CONSTRAINT_WORD[state]}</span>
            <span className="min-w-0 type-body-sm text-slate-200">{v.constraint.label}</span>
            <span data-testid="comparison-constraint-threshold" className="font-mono type-mono-sm tabular-nums text-slate-400">
              {constraintBound(v)}
            </span>
            <span className="font-mono type-mono-sm tabular-nums text-white">
              {v.observed == null ? <span className="text-slate-500">not measured</span> : v.observed}
            </span>
            <Kicker tone="muted">{v.constraint.kind}</Kicker>
          </li>
        );
      })}
    </ul>
  );
}
