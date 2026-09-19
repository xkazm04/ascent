// Ranked sink-B invokes by registry skill name, beside the 30d registry readout.
// Never summed with invokesDirect30d. Keys are names (a registry-only skill has no OrgSkill id).
// Hatched (`not-judged`) until an index pass has read the lane — unread is not a row of zeros.

import { rendersValue, stateTitle, type VizState } from "@/components/org/viz";
import { MatrixHatchDefs, MatrixMark } from "@/components/org/viz/matrixMark";
import type { RegistryView } from "@/lib/org/registry-view";

export type InvokesBySkillRow = { name: string; invokes: number };

/** Highest count first; name is the stable tie-break. Absent map → no rows, never invented zeros. */
export function rankInvokesBySkill(bySkill: Record<string, number> | undefined): InvokesBySkillRow[] {
  if (!bySkill) return [];
  return Object.entries(bySkill)
    .filter(([name]) => name.length > 0)
    .map(([name, invokes]) => ({ name, invokes }))
    .sort((a, b) => b.invokes - a.invokes || a.name.localeCompare(b.name));
}

export function RegistryInvokesBySkill({ view }: { view: RegistryView }) {
  // Same unread test as the 30d registry readout: column defaults before a pass are not a fleet of zeroes.
  const laneRead = Boolean(view.registry?.lastIndexedAt);
  const state: VizState = laneRead ? "measured" : "not-judged";
  const rows = laneRead ? rankInvokesBySkill(view.telemetry.invokesBySkill) : [];

  return (
    <div data-invokes-by-skill data-state={state} className="py-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="type-label tracking-[0.16em] text-slate-500">invokes by skill</span>
        {state === "not-judged" ? (
          <span
            className="relative h-4 w-10 shrink-0"
            role="img"
            aria-label={stateTitle(state, "invokes by skill")}
          >
            <MatrixHatchDefs />
            <MatrixMark state={state} alpha={1} />
          </span>
        ) : null}
      </div>
      {rows.length > 0 ? (
        <ul className="mt-1 space-y-0.5">
          {rows.map((row) => (
            <li key={row.name} data-skill={row.name} className="flex items-baseline justify-between gap-3 pl-2">
              <span className="min-w-0 truncate type-mono-sm text-slate-400" title={row.name}>
                {row.name}
              </span>
              {rendersValue(state) ? (
                <span data-count className="type-mono-sm tabular-nums text-slate-200">
                  {row.invokes.toLocaleString()}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
