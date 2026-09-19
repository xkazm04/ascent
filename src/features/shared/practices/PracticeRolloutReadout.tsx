// The library row's right-hand column — the COUNTS the stage cells deliberately refuse to paint.
//
// Carried over from the retired PracticeLedger (2026-09-16). The cells say what KIND of fact each
// stage is (measured, declared, not judged, void); this column says how much: the adoption count and
// who could still adopt, then what applying has put in motion — PRs in flight, landed, and the
// measured lift on the practice's own dimension. A PR count never goes on the maturity ramp, which is
// why it lives here as a figure and not in a cell.
//
// Server-safe: no hooks, no handlers.

import { StateSwatch, type VizState } from "@/components/org/viz";
import { deltaHex, fmtDelta } from "@/components/org/shared/ui";
import type { PracticeRow } from "./practiceRows";

/** A mined practice no repository was scored on is `not-judged`; an authored adoption is a recorded
 *  application (`declared`); everything else was observed. */
function adoptionState(row: PracticeRow): VizState {
  if (row.source === "authored") return "declared";
  return (row.mined?.total ?? 0) === 0 ? "not-judged" : "measured";
}

function Adoption({ row }: { row: PracticeRow }) {
  const state = adoptionState(row);
  return (
    <div className="flex items-center gap-1.5">
      <StateSwatch state={state} />
      <span className={`type-mono-sm tabular-nums ${state === "not-judged" ? "text-slate-500" : "text-slate-200"}`}>
        {state === "not-judged" ? "not assessed" : row.adoptionLabel}
      </span>
    </div>
  );
}

/** Silent until the practice has been applied once, so an untouched row stays calm. */
function Motion({ rollout }: { rollout: PracticeRow["rollout"] }) {
  if (!rollout || (rollout.open === 0 && rollout.merged === 0)) return null;
  const { open, merged, lift } = rollout;
  return (
    <div data-motion className="flex flex-wrap gap-x-2 type-caption tabular-nums">
      {open > 0 && <span className="text-accent">{open} in flight</span>}
      {merged > 0 && <span className="text-slate-300">{merged} landed</span>}
      {merged > 0 &&
        (lift != null ? (
          <span style={{ color: deltaHex(lift) }}>{fmtDelta(lift)} avg</span>
        ) : (
          <span className="text-slate-500">awaiting rescan</span>
        ))}
    </div>
  );
}

export function PracticeRolloutReadout({ row }: { row: PracticeRow }) {
  return (
    <div className="min-w-0 space-y-0.5 pl-3">
      <Adoption row={row} />
      {row.reachLabel && <div className="type-caption text-slate-500">{row.reachLabel}</div>}
      <Motion rollout={row.rollout} />
    </div>
  );
}
