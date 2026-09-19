// One State cell of the control ledger (MC-B13). Extracted from ControlTimelineCard so the card
// stays inside the 200-LOC cap this directory enforces. Server-safe: no hooks, no handlers.
//
// Three contracts the catalogue has always authored and nothing rendered until now:
//
//   • `descriptor` — `repo-visibility` is not a bar, it is a FACT. Its state is always `pass`, so
//     the old cell printed a green "operating" for a control that cannot operate or fail. A
//     descriptor now renders its VALUE ("public"), in neutral tone, with no verdict word at all.
//   • `failMeans` — a red "not operating" ships WITH the catalogue's own sentence for what that
//     fail means. On `advisories` that sentence is "NOT a statement that the repo is insecure", and
//     its absence is what turned a screenshot of this table into a report of nine failed security
//     controls to a CISO. The disclaimer is in the cell, not in a tooltip: a screenshot crops
//     tooltips and keeps text.
//   • `stateTone` — the tone comes from the catalogue's function, never from a ternary re-typed
//     here. A renderer with its own copy is a renderer that can drift from the three-state
//     vocabulary the ledger's whole honesty contract rests on.

import { STATE_TITLE, type TimelineRow } from "./controlTimeline";

const TONE_CLASS: Record<TimelineRow["tone"], string> = {
  good: "text-emerald-400",
  bad: "text-red-400",
  // Deliberately not a colour word. `unmeasurable` is absent evidence, not a finding.
  unknown: "text-slate-500",
};

export function ControlStateCell({ row }: { row: TimelineRow }) {
  if (row.state === "unmeasurable") {
    return (
      <span className={TONE_CLASS.unknown} title={STATE_TITLE.unmeasurable}>
        —
      </span>
    );
  }

  // A descriptor reports a fact in its value; it has no bar to clear, so it is given no verdict.
  if (row.descriptor) {
    return (
      <span className="text-slate-300" title="A descriptor, not a bar: this control reports a fact and can never fail.">
        {row.value ?? "—"}
      </span>
    );
  }

  return (
    <div>
      <span className={TONE_CLASS[row.tone]} title={STATE_TITLE[row.state]}>
        {row.state === "pass" ? "operating" : "not operating"}
        {/* The value carries what the state cannot: a required-approvals count, a rule count. */}
        {row.value && row.value !== "true" && row.value !== "false" ? (
          <span className="text-slate-500"> · {row.value}</span>
        ) : null}
      </span>
      {row.failMeans ? <p className="mt-1 max-w-[26rem] type-micro text-slate-400">{row.failMeans}</p> : null}
    </div>
  );
}
