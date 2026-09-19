"use client";

// The library's grid: a head row on the one hairline, then one section per dimension, each opening
// on a heading that states the group's measured adoption (or only its size, when nothing in it was
// assessed). Wide on purpose — the stage cells stay legible and the row scrolls sideways on a phone
// rather than crushing the practice names.

import { MatrixHatchDefs } from "@/components/org/viz/matrixMark";
import type { PracticeRow } from "./practiceRows";
import { ROLLOUT_AXES } from "./practiceRolloutViz";
import { groupReadout, type RolloutGroup } from "./practiceRolloutGroups";
import { PracticeRolloutRow, ROLLOUT_TEMPLATE } from "./PracticeRolloutRow";

const HEAD = "type-micro self-end border-b border-divider pb-1.5 font-mono uppercase tracking-[0.18em] text-slate-600";

export function PracticeRolloutMatrix({
  title,
  groups,
  onOpen,
}: {
  title: string;
  groups: RolloutGroup[];
  onOpen: (row: PracticeRow) => void;
}) {
  return (
    <div role="group" aria-label={title} className="overflow-x-auto">
      <div className="relative min-w-[44rem]">
        <MatrixHatchDefs />
        <div className="grid" style={{ gridTemplateColumns: ROLLOUT_TEMPLATE }}>
          <div className={HEAD}>practice</div>
          {ROLLOUT_AXES.map((a) => (
            <div key={a} className="type-label self-end border-b border-divider px-1 pb-1.5 text-center leading-tight tracking-[0.08em] text-slate-400">
              {a}
            </div>
          ))}
          <div className={`${HEAD} pl-3`}>adoption · motion</div>
        </div>

        {groups.map((g) => (
          <section key={g.dimId} aria-label={g.label} data-group={g.dimId} className="mt-4">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 border-b border-divider pb-1">
              <h4 className="type-label tracking-[0.14em] text-slate-300">{g.label}</h4>
              <span className="type-mono-sm tabular-nums text-slate-500">{groupReadout(g)}</span>
            </div>
            {g.entries.map((e) => (
              <PracticeRolloutRow key={e.row.key} entry={e} onOpen={onOpen} />
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}
