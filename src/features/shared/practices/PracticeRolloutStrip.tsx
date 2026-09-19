"use client";

// The Practice Library — what every practice has put in motion, DRAWN, per dimension.
//
// G7-20 made this a matrix: every practice against every stage of its rollout, the stages painted in
// the /org kit's epistemic states rather than asserted in six descriptive props (docs/ORG-UX-REDESIGN
// §1 / A2). On 2026-09-16 it absorbed the ledger table that used to sit under it (PracticeLedger), so
// the library has ONE reading instead of two of the same rows:
//   - every practice, not the first eight, grouped by the dimension it lifts;
//   - per row, the ledger's facts the matrix lacked — description, Authored/Mined source, adoption
//     count and reach, PRs in flight / landed / measured lift — beside the stage cells;
//   - a row opens the practice (the detail modal: exemplar, gap repos, apply), and a mined row keeps
//     the `#practice-<id>` anchor four other surfaces deep-link to.
//
// Every number is still folded from rows already on screen; nothing is fetched here.

import { useMemo, useState } from "react";
import { Kicker } from "@/components/ui";
import { InlineEmpty } from "@/components/org/shared/ui";
import { Legend, WhyChip } from "@/components/org/viz";
import { rolloutIsMeaningful, type PracticeRollout, type PracticeRow } from "./practiceRows";
import { PracticeRolloutTotals } from "./PracticeRolloutTotals";
import { PracticeRolloutMatrix } from "./PracticeRolloutMatrix";
import { ROLLOUT_AXES, ROLLOUT_HINT, rolloutScopeLine, rolloutVizStates } from "./practiceRolloutViz";
import { rolloutGroups, type RolloutSource } from "./practiceRolloutGroups";

/**
 * (O) — the argument the strip used to make above a populated panel now lives where a reader has
 * nothing to look at and a genuine reason to act: before anything has rolled out.
 */
const NOTHING_ROLLED_OUT =
  "Nothing has rolled out yet. Applying a practice opens a draft pull request the target repo's own reviewers approve; the lift it produced is measured only once a scan lands on the far side of the merge.";

const SOURCES: { id: RolloutSource; label: string }[] = [
  { id: "all", label: "All" },
  { id: "authored", label: "Authored" },
  { id: "mined", label: "Mined" },
];

const noop = () => {};

export function PracticeRolloutStrip({
  rollout,
  rows,
  fleetSize,
  onOpen = noop,
}: {
  rollout: PracticeRollout;
  /** The library's rows — the grid folds these, so no figure here can disagree with another. */
  rows: readonly PracticeRow[];
  /** The org's scannable repo count: the denominator the `Assessed` column is a share of. */
  fleetSize: number;
  /** Open a practice's detail modal. */
  onOpen?: (row: PracticeRow) => void;
}) {
  const [source, setSource] = useState<RolloutSource>("all");
  const groups = useMemo(() => rolloutGroups(rows, fleetSize, source), [rows, fleetSize, source]);
  if (rows.length === 0) return null;

  const entries = groups.flatMap((g) => g.entries);
  const states = rolloutVizStates(entries.map((e) => ({ id: e.row.key, label: e.row.label, cells: e.cells })));
  const mixed = rows.some((r) => r.source === "authored") && rows.some((r) => r.source === "mined");

  return (
    <section className="space-y-4 rounded-xl border border-divider bg-surface/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex flex-wrap items-baseline gap-x-3">
          <Kicker>rollout</Kicker>
          <span className="type-mono-sm text-slate-500">{rolloutScopeLine(entries.length, rows.length, fleetSize)}</span>
        </div>
        {mixed && (
          <div role="group" aria-label="Filter by source" className="flex items-center gap-1">
            {SOURCES.map((s) => (
              <button
                key={s.id}
                type="button"
                aria-pressed={source === s.id}
                onClick={() => setSource(s.id)}
                className={`focus-ring rounded-full border px-2.5 py-0.5 type-caption transition ${
                  source === s.id ? "border-accent/60 text-white" : "border-divider text-slate-400 hover:border-accent hover:text-white"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        )}
      </div>

      <PracticeRolloutMatrix
        title={`Practice rollout across ${fleetSize} ${fleetSize === 1 ? "repository" : "repositories"}`}
        groups={groups}
        onOpen={onOpen}
      />

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
