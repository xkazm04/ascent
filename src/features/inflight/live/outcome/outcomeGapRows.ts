// ONE ROW = ONE GAP, with a STATE. The Storyboard's expanded frame renders a repo as a section
// label and one row per individual gap/deliverable beneath it; this module is the pure fold that
// produces those rows from a repo's lanes. Each row carries:
//
//   • `state` — the tinted block the row renders as:
//       `committed`   — the claim is covered by real commits (lane commits > 0 AND the verdict is
//                       attributable, the claim id is in `closedIds`, or it is the lane's own
//                       deterministic install commit) → success tint;
//       `uncommitted` — the agent claimed RESOLVED but the lane recorded no commits (the lost-
//                       deliverable case) → warn tint;
//       `proposed`    — a batch item the run armed but did not resolve (batchIds minus closed
//                       claims), or a `noted` deliverable → neutral tint.
//   • `laneId` — the lane to POST a review against, and `review` — the owner's standing ruling.
//
// Review markers (`isReviewMarker`, loop-runs-types.ts) are never rendered: they exist to carry a
// ruling for a row that was not persisted, and this fold attaches each one to the row it keys.

import { isReviewMarker, type LaneDeliverable } from "@/lib/db/loop-runs-types";
import { laneAttribution } from "../cockpit/cockpitDrift";
import type { LoopLaneOutcome } from "../cockpit/loopTypes";
import { DELIVERABLE_KIND_ORDER } from "./outcomeDeliverables";

export type DeliverableState = "proposed" | "committed" | "uncommitted";

export interface GapRow extends LaneDeliverable {
  state: DeliverableState;
  /** The lane this row belongs to — the review POST's address. */
  laneId: string;
}

/** The review key a row is addressed by: its first covered id, else its headline. */
export const rowCover = (d: Pick<LaneDeliverable, "covers" | "headline">): string => d.covers[0] ?? d.headline;

function stateOf(d: LaneDeliverable, o: LoopLaneOutcome): DeliverableState {
  if (d.kind === "noted") return "proposed";
  if (o.commits === 0) return "uncommitted";
  const closed = new Set(o.closedFollowUpIds);
  if (laneAttribution(o).kind === "attributable" || d.covers.some((id) => closed.has(id)) || d.kind === "installed") {
    return "committed";
  }
  // Committed work whose measurement was refused (within noise, mock) — still awaiting a verdict.
  return "proposed";
}

/** A repo's gap rows across its lanes: every deliverable, PLUS a `proposed` row for every armed
 *  batch item no deliverable accounts for — all gaps get rows. Deduped only on a TRUE duplicate
 *  (the same covered id, or the same movement headline in one dimension, across cycles). */
export function buildGapRows(lanes: readonly LoopLaneOutcome[]): GapRow[] {
  const out: GapRow[] = [];
  const keyOf = (d: LaneDeliverable) =>
    d.covers.length > 0 ? `id|${d.covers[0]}` : `${d.kind}|${d.dimId ?? ""}|${d.headline.toLowerCase()}`;
  const byKey = new Map<string, GapRow>();
  const push = (row: GapRow) => {
    const dup = byKey.get(keyOf(row));
    if (dup) {
      dup.covers = [...new Set([...dup.covers, ...row.covers])];
      dup.evidence = dup.evidence ?? row.evidence;
      dup.review = dup.review ?? row.review;
      if (row.state === "committed") dup.state = "committed";
      return;
    }
    byKey.set(keyOf(row), row);
    out.push(row);
  };

  const markers: { cover: string; review: NonNullable<LaneDeliverable["review"]> }[] = [];
  for (const o of lanes) {
    for (const d of o.deliverables ?? []) {
      if (isReviewMarker(d)) {
        if (d.review) markers.push({ cover: d.covers[0]!, review: d.review });
        continue;
      }
      push({ ...d, covers: [...d.covers], state: stateOf(d, o), laneId: o.lane.id });
    }
  }
  // The armed-but-unresolved batch items: proposed rows, titled from the follow-up itself.
  for (const o of lanes) {
    const closed = new Set(o.closedFollowUpIds);
    const titles = new Map<string, string>();
    for (const r of [...(o.after?.recommendations ?? []), ...(o.before?.recommendations ?? [])]) {
      if (!titles.has(r.id)) titles.set(r.id, r.title);
    }
    for (const id of o.lane.batchIds) {
      if (closed.has(id) || byKey.has(`id|${id}`)) continue;
      push({ headline: titles.get(id) ?? id, dimId: null, kind: "noted", covers: [id], evidence: null, state: "proposed", laneId: o.lane.id });
    }
  }
  // Attach each marker's ruling to the row it keys — a re-derived or synthesized row keeps its review.
  for (const m of markers) {
    const row = out.find((r) => r.covers.includes(m.cover)) ?? out.find((r) => r.headline === m.cover);
    if (row && !row.review) row.review = m.review;
  }
  const rank = (k: LaneDeliverable["kind"]) => DELIVERABLE_KIND_ORDER.indexOf(k);
  return out.sort((a, b) => rank(a.kind) - rank(b.kind) || (a.dimId ?? "D~").localeCompare(b.dimId ?? "D~"));
}
