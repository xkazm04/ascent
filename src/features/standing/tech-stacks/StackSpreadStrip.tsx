// First sight for the Tech Stacks tab: the shape of the fleet's stack maturity, before the rail of
// per-stack numbers that used to be the topmost thing on the page.
//
// The rail answers "what did each stack score" as a sorted list; the question a reader actually
// arrives with is "how far apart are they" — which is a distribution, and is drawn, not listed. The
// quartiles cover the MEASURED stacks only; a stack nobody has scanned is counted beside the strip
// as `not-judged` rather than folded in at its sentinel 0, which would drag the minimum to zero and
// invent a spread the fleet does not have.

import { Distribution, Legend } from "@/components/org/viz";
import type { SegmentSummary } from "@/lib/db";
import { stackSpread } from "@/features/standing/tech-stacks/stackMeasure";

export function StackSpreadStrip({ stacks }: { stacks: SegmentSummary[] }) {
  const spread = stackSpread(stacks);
  // One measured stack is not a distribution. The analysis below already states the two-stack floor.
  if (!spread) return null;

  return (
    <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
      <Distribution
        className="w-full max-w-[22rem]"
        label="Stack maturity, overall score"
        min={spread.min}
        q1={spread.q1}
        median={spread.median}
        q3={spread.q3}
        max={spread.max}
        n={spread.n}
        digits={0}
      />
      {spread.unmeasured > 0 && (
        <div className="flex items-center gap-2 pb-2">
          <Legend states={["not-judged"]} />
          <span className="type-caption tabular-nums text-slate-500">× {spread.unmeasured}</span>
        </div>
      )}
    </div>
  );
}
