"use client";

// One repository's row in the admission column. Extracted from AdmissionColumn so both files stay
// inside the 200-LOC cap this directory enforces; behaviour is unchanged apart from the mark.
//
// The mark is the point (org UX redesign §2.4): a row a PERSON decided wears the kit's `decided`
// accent ring, a row still on the seed copied from the derived tier is `measured`, and a repo with
// no passport and no decision is the `missing` void. That is the sentence "the tier a scan DERIVES
// is a measurement, admission is the decision" made into an encoding, with the sentence itself
// reachable as the swatch's own generated title.

import { StateSwatch, stateTitle } from "@/components/org/viz";
import { MODE_HEX, MODE_META, type AdmissionView } from "./admissionRows";
import { viewState } from "./admissionLadder";
import { AdmissionOverrideControl } from "./AdmissionOverrideControl";

/** The neutral rail for a repo nothing has been recorded or measured for — never a mode colour. */
const UNASSESSED_HEX = "#475569";

export function AdmissionRow({
  org,
  view,
  canEdit,
  onSaved,
}: {
  org: string;
  view: AdmissionView;
  canEdit: boolean;
  onSaved: () => void;
}) {
  // A repo with no passport and no decision has NO admission row at all, so the gate applies no bar
  // to it. Painting it with the middle rung's colour and label would claim an enforcement that does
  // not exist — the exact confusion between a measurement and a decision this column is here to end.
  const hex = view.unassessed ? UNASSESSED_HEX : MODE_HEX[view.mode];
  const state = viewState(view);
  return (
    <div className="relative overflow-hidden rounded-xl border border-divider bg-surface/40 px-4 py-3">
      <div aria-hidden className="absolute inset-y-0 left-0 w-1" style={{ backgroundColor: hex }} />
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 pl-2">
        <span className="self-center" title={stateTitle(state, view.name)}>
          <StateSwatch state={state} baseColor={hex} size={12} />
        </span>
        <span className="type-mono-sm text-slate-100">{view.name}</span>
        <span className="font-mono type-micro uppercase tracking-[0.18em]" style={{ color: hex }}>
          {view.unassessed ? "Not assessed" : MODE_META[view.mode].label}
        </span>
        <span className="font-mono type-micro tabular-nums text-slate-400">{view.tier ?? "tier not assessed"}</span>
        {/* A seed is not a decision, and the surface must never let the two look alike. */}
        <span className="type-body-sm text-slate-500">
          {view.decided
            ? `decided by @${view.decidedBy}`
            : view.unassessed
              ? "nothing recorded — no admission bar applies here"
              : "seeded from the derived tier — nobody has decided"}
        </span>
        {view.overridesDerived && (
          <span className="font-mono type-micro text-orange-300">overrides derived {view.overridesDerived}</span>
        )}
        {view.stale && (
          <span
            className="font-mono type-micro text-orange-300"
            title="Recorded against an older stance version and recompiled against the current one — not re-affirmed."
          >
            stale decision
          </span>
        )}
        {view.rulesetId && <span className="font-mono type-micro text-emerald-300">ruleset applied</span>}
        <span className="ml-auto type-body-sm text-slate-500">
          {view.unassessed ? "Scan this repository to derive a tier, or record a decision now." : MODE_META[view.mode].blurb}
        </span>
      </div>
      {canEdit && <AdmissionOverrideControl org={org} view={view} onSaved={onSaved} />}
    </div>
  );
}
