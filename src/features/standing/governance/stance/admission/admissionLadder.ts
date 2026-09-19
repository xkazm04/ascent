// The admission column's headline geometry (org UX redesign §2).
//
// The paragraph this replaces was the sharpest sentence on the tab and the worst-placed one:
//   "The tier a scan DERIVES is a measurement. Admission is the decision."
// The kit already has that distinction as an ENCODING — `decided` paints an accent ring around the
// mark, and `STATE_HINT.decided` carries the sentence on hover/focus. So the three admission rungs
// become nested bands (most permissive outermost), a rung somebody actually decided wears the ring,
// and repos nothing has been recorded or measured for cross the outer edge as a `missing` void
// rather than borrowing the middle rung's colour.
//
// PURE — no React, no hooks. Server-safe.

import type { LadderBand, LadderEdge, VizState } from "@/components/org/viz";
import type { AdmissionMode } from "@/lib/org/admission";
import { MODE_HEX, MODE_META, type AdmissionView } from "./admissionRows";

/** Outermost (most permissive) first — the order the ladder insets. */
export const LADDER_ORDER: readonly AdmissionMode[] = ["agents-allowed", "assisted-only", "blocked"];

/**
 * One row's state.
 *
 * `missing` for an unassessed repo is deliberate and load-bearing: no admission row exists for it,
 * the gate applies no bar, and the kit's void draws NOTHING rather than a mark that would claim an
 * enforcement that is not there. `decided` is a person's decision; `measured` is the seed copied
 * from the derived tier, which is a measurement nobody has ratified.
 */
export function viewState(v: AdmissionView): VizState {
  if (v.unassessed) return "missing";
  return v.decided ? "decided" : "measured";
}

export function admissionBands(views: readonly AdmissionView[]): LadderBand[] {
  return LADDER_ORDER.map((mode) => {
    const inBand = views.filter((v) => !v.unassessed && v.mode === mode);
    // The ring goes on a rung a PERSON put a repository in. A rung holding only seeds is a
    // measurement of where the derived tiers landed, and it is drawn as one.
    const state: VizState = inBand.some((v) => v.decided) ? "decided" : "measured";
    return { id: mode, label: MODE_META[mode].label, state, count: inBand.length, color: MODE_HEX[mode] };
  });
}

/** Repositories nothing is recorded for. Null when every repo has a rung — no void, no arrow. */
export function admissionEdge(views: readonly AdmissionView[]): LadderEdge | null {
  const n = views.filter((v) => v.unassessed).length;
  if (n === 0) return null;
  return { label: "not assessed · no bar applies", count: n, state: "missing" };
}

/** Only the states this column draws, in the vocabulary's own order. */
export function admissionStates(views: readonly AdmissionView[]): VizState[] {
  const present = new Set(views.map(viewState));
  if (views.some((v) => !v.unassessed && !v.decided)) present.add("measured");
  return (["measured", "missing", "decided"] as const).filter((s) => present.has(s));
}
