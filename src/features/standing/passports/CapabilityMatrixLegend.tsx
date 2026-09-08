// #13 — the legend for the per-repo capability TABLE (the grid above it carries the kit's own
// `Legend`, painted from `stateFill`/`stateStroke`).
//
// It is a separate file because the four cell states and the two control placements are the part a
// reader MUST be able to decode, and burying them under a table is how a matrix becomes decoration.
//
// /org redesign: the hand-rolled `<span>`-per-mark layout is gone. This is the shared kit `Legend`
// with the table's real marks passed as `extra` swatches — the SAME element `Cell` renders, from the
// same `CELL_STYLE`, so a legend can never describe a mark the table draws differently, and this tab
// cannot drift away from Governance's legend chrome. The four sentences that used to sit beside the
// marks are now each row's `hint`: present on hover/focus, absent at first sight (§2.1 D).

import { Legend, type LegendExtra } from "@/components/org/viz";
import { CELL_STYLE, type CapabilityState } from "./capabilityAgg";

const WHAT: Record<CapabilityState, string> = {
  verified: "The repository's own doctor RAN this command and it passed.",
  declared: "Declared in the manifest; not run, or its last run failed.",
  placeholder: "Declared but still a <placeholder> — not fillable yet.",
  absent: "This repository does not declare this capability at all.",
};

const STATES: CapabilityState[] = ["verified", "declared", "placeholder", "absent"];

/** The table's own mark, at legend scale — the identical span `Cell` paints. */
function Mark({ state }: { state: CapabilityState }) {
  return (
    <span className={`inline-flex h-5 min-w-5 items-center justify-center rounded px-1.5 type-caption ${CELL_STYLE[state].className}`}>
      {CELL_STYLE[state].mark}
    </span>
  );
}

const EXTRA: LegendExtra[] = [
  ...STATES.map((state) => ({ id: state, label: state, swatch: <Mark state={state} />, hint: WHAT[state] })),
  {
    id: "prePush",
    label: "enforced pre-push",
    swatch: <span className="border-b border-accent/70 px-2 type-caption text-slate-300">abc</span>,
    hint: "The declaration is wired into this repository's pre-push hook.",
  },
  {
    id: "ciHardPass",
    label: "enforced as a CI hard pass",
    swatch: <span className="border-b border-dotted border-accent/70 px-2 type-caption text-slate-300">abc</span>,
    hint: "The declaration is wired into CI as a required pass.",
  },
];

export function CapabilityMatrixLegend() {
  return <Legend extra={EXTRA} />;
}
