// #13 — the legend for the capability matrix, and the honest-absence copy that goes with it.
//
// It is a separate file because the four cell states and the two control placements are the part a
// reader MUST be able to decode, and burying them under a table is how a matrix becomes decoration.
// Every state here is a claim about evidence, so each one says what evidence produced it.

import { CELL_STYLE, type CapabilityState } from "./capabilityAgg";

const STATES: { state: CapabilityState; what: string }[] = [
  { state: "verified", what: "the repo's own doctor RAN this command and it passed" },
  { state: "declared", what: "declared in the manifest; not run, or its last run failed" },
  { state: "placeholder", what: "declared but still a <placeholder> — not fillable yet" },
  { state: "absent", what: "this repo does not declare this capability at all" },
];

export function CapabilityMatrixLegend({ unassessed }: { unassessed: number }) {
  return (
    <div className="space-y-3 type-body-sm text-slate-400">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        {STATES.map(({ state, what }) => (
          <span key={state} className="flex items-center gap-2">
            <span className={`inline-flex h-5 min-w-5 items-center justify-center rounded px-1.5 type-caption ${CELL_STYLE[state].className}`}>
              {CELL_STYLE[state].mark}
            </span>
            <span>
              <span className="text-slate-300">{state}</span> — {what}
            </span>
          </span>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <span className="flex items-center gap-2">
          <span className="border-b border-accent/70 px-2 type-caption text-slate-300">abc</span>
          <span>enforced pre-push</span>
        </span>
        <span className="flex items-center gap-2">
          <span className="border-b border-dotted border-accent/70 px-2 type-caption text-slate-300">abc</span>
          <span>enforced as a CI hard pass</span>
        </span>
      </div>
      {unassessed > 0 && (
        <p className="text-slate-500">
          {unassessed} {unassessed === 1 ? "repository is" : "repositories are"} listed separately below as{" "}
          <span className="text-slate-300">not assessed</span>: their latest scan read no manifest, so they are
          excluded from every count above rather than counted as declaring nothing.
        </p>
      )}
    </div>
  );
}
