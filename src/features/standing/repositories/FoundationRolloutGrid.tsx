// The foundation rollout's first sight: repos × (PR · report-back · conformance), as a matrix.
//
// docs/ORG-UX-REDESIGN.md §2.2/§2.4. The two sentences that used to sit under the table — "— under
// Conformance means NEVER REPORTED, not 0%" and "Not provisioned means Ascent has written no
// report-back secrets here" — are the `missing` void in this grid, which cannot print a number; the
// third state, a repo Ascent never opened a PR in, is the hatch. `foundationViz.ts` holds the mapping
// and the reasoning; this file only draws it.
//
// The grid shows the least-covered repos first and defers to the table below for the rest: an
// overview graphic and an auditable row list are different jobs (§2.7).

import { Kicker } from "@/components/ui";
import { Legend, MatrixGrid, WhyChip } from "@/components/org/viz";
import { FOUNDATION_AXES, type FoundationViz } from "./foundationViz";

const DRAFT_HINT =
  "A foundation PR is opened as a DRAFT, so an opened PR is a proposal this organization has made — not an observation that `.ai/` is on the default branch. A repo whose team committed `.ai/` by hand never passes through Ascent and is hatched here: not judged, not absent.";

export function FoundationRolloutGrid({ viz }: { viz: FoundationViz }) {
  if (viz.rows.length === 0) return null;
  return (
    <div className="mt-4 rounded-2xl border border-divider bg-surface/40 p-4">
      <div className="flex items-center justify-between gap-3">
        <Kicker tone="muted">rollout by repository</Kicker>
        <WhyChip hint={DRAFT_HINT} label="what an opened PR proves" align="end" />
      </div>
      <MatrixGrid
        className="mt-2 max-w-lg"
        axes={[...FOUNDATION_AXES]}
        rows={viz.rows}
        title="Foundation rollout by repository"
      />
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <Legend states={viz.states} />
        {viz.overflow > 0 && (
          <Kicker tone="muted" as="span">
            +<span className="tabular-nums">{viz.overflow}</span> more in the table
          </Kicker>
        )}
      </div>
    </div>
  );
}
