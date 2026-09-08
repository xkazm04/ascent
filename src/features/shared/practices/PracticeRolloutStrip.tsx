// G7-20 — what the Practice Library has put in motion, DRAWN.
//
// This panel used to be four numbers under six descriptive props. The concept underneath it is a
// matrix — every practice against every stage of its rollout — and four of those props were the
// epistemic states the /org kit already defines, delivered as sentences the reader had to hold in
// their head while looking at a strip that did not show them (docs/ORG-UX-REDESIGN.md §1 / A2).
//
// So first sight is the matrix (§2.2), the states are painted rather than asserted (§2.4), and the
// demoted sentences ride on `WhyChip`s and the `Legend`'s row hints — reachable on focus, absent at
// first sight (§2.1 D). The figures themselves live below it, unchanged.
//
// Every number is still folded from rows already on screen (`summarizeRollout`); nothing is fetched
// or persisted for this panel.
//
// Server-safe: no hooks, no handlers of its own.

import { Kicker } from "@/components/ui";
import { InlineEmpty } from "@/components/org/shared/ui";
import { Legend, MatrixGrid, WhyChip } from "@/components/org/viz";
import { rolloutIsMeaningful, type PracticeRollout, type PracticeRow } from "./practiceRows";
import { PracticeRolloutTotals } from "./PracticeRolloutTotals";
import {
  ROLLOUT_AXES,
  ROLLOUT_HINT,
  rolloutMatrixRows,
  rolloutScopeLine,
  rolloutVizStates,
} from "./practiceRolloutViz";

/**
 * (O) — the argument the strip used to make above a populated panel now lives where a reader has
 * nothing to look at and a genuine reason to act: before anything has rolled out.
 */
const NOTHING_ROLLED_OUT =
  "Nothing has rolled out yet. Applying a practice opens a draft pull request the target repo's own reviewers approve; the lift it produced is measured only once a scan lands on the far side of the merge.";

export function PracticeRolloutStrip({
  rollout,
  rows,
  fleetSize,
}: {
  rollout: PracticeRollout;
  /** The ledger's own rows — the matrix folds these, so it can never disagree with the table below. */
  rows: readonly PracticeRow[];
  /** The org's scannable repo count: the denominator the `Assessed` column is a share of. */
  fleetSize: number;
}) {
  if (rows.length === 0) return null;
  const vizRows = rolloutMatrixRows(rows, fleetSize);
  const states = rolloutVizStates(vizRows);

  return (
    <section className="space-y-4 rounded-xl border border-divider bg-surface/40 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <Kicker>rollout</Kicker>
        <span className="type-mono-sm text-slate-500">{rolloutScopeLine(vizRows.length, rows.length, fleetSize)}</span>
      </div>

      <div className="max-w-lg">
        <MatrixGrid
          axes={[...ROLLOUT_AXES]}
          rows={vizRows}
          title={`Practice rollout across ${fleetSize} ${fleetSize === 1 ? "repository" : "repositories"}`}
        />
      </div>

      <Legend states={states} />

      {/* The four demoted column captions, one chip each: what the column measures and what its
          hatch or its void means. Present on focus, absent at first sight. */}
      <ul className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        {ROLLOUT_AXES.map((axis) => (
          <li key={axis} className="flex items-center gap-1.5">
            <Kicker tone="muted" as="span">
              {axis}
            </Kicker>
            <WhyChip hint={ROLLOUT_HINT[axis]} label={axis} />
          </li>
        ))}
      </ul>

      {rolloutIsMeaningful(rollout) ? (
        <div className="border-t border-divider pt-4">
          <PracticeRolloutTotals rollout={rollout} />
        </div>
      ) : (
        <InlineEmpty>{NOTHING_ROLLED_OUT}</InlineEmpty>
      )}
    </section>
  );
}
