// ONE ROW = ONE GAP, with a STATE. The sheet renders a repo as a group-header row and one first-class
// sheet row per individual gap/deliverable beneath it; this module is the pure fold that produces
// those rows from a repo's lanes for ONE run (outcomeSheet.ts then folds them ACROSS runs into the
// sheet's row axis, keyed by `gapKey`). Each row carries:
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
// The wire carries `dimId` as a plain string (it is a database column); a row's `dimId` is the closed
// `DimensionId`. An unrecognised value is dropped rather than cast — a dimension nothing can render
// is worse than none.
import { isDimensionId } from "@/lib/maturity/model";
import { laneAttribution } from "../cockpit/cockpitDrift";
import type { LoopLaneOutcome } from "../cockpit/loopTypes";
import { DELIVERABLE_KIND_ORDER } from "./outcomeDeliverables";

export type DeliverableState = "proposed" | "committed" | "uncommitted";

/** `LoopRunDetail.batchTitles` — the run's dispatched items resolved to titles, server-side. */
export type BatchTitles = Readonly<Record<string, { title: string; dimId: string | null }>>;

/** THE LAST RESORT, and it is deliberately not a uuid. An id nothing could title — not the lane's
 *  scans, not its diff, not its own deliverables, not the run's `batchTitles` — is an item whose
 *  `Recommendation` row is gone. The row still earns its place (the loop WAS asked to do something),
 *  so it says what it is and carries a short id to tell two of them apart; a bare uuid said neither. */
export const untitledBatchItem = (id: string): string => `Armed item · ${id.slice(0, 8)}`;

export interface GapRow extends LaneDeliverable {
  state: DeliverableState;
  /** The lane this row belongs to — the review POST's address. */
  laneId: string;
  /** True only when the rescan's adjudicated set (`closedFollowUpIds`) names this close.
   *  Absent = unverified — the safe direction, matching CockpitVerdicts. */
  verified?: true;
}

/** The review key a row is addressed by: its first covered id, else its headline. */
export const rowCover = (d: Pick<LaneDeliverable, "covers" | "headline">): string => d.covers[0] ?? d.headline;

/** THE IDENTITY OF A GAP, within a run and ACROSS runs. A covered follow-up id is the strong key —
 *  the same gap worked in run 3 and revisited in run 7 carries the same id, which is what lets the
 *  sheet give it ONE row with content in those two columns and blank cells between. Without an id
 *  the fallback is the shape the headline was derived from (kind + dimension + wording), which is
 *  also what stops two different gaps in one dimension collapsing into one row. */
export const gapKey = (d: Pick<LaneDeliverable, "covers" | "headline" | "kind" | "dimId">): string =>
  d.covers.length > 0 ? `id|${d.covers[0]}` : `${d.kind}|${d.dimId ?? ""}|${d.headline.toLowerCase()}`;

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
 *  (the same covered id, or the same movement headline in one dimension, across cycles).
 *
 *  `batchTitles` is the run's server-side id → title resolution (`LoopRunDetail.batchTitles`), and is
 *  optional because a payload from a server older than that field simply does not carry one. */
export function buildGapRows(lanes: readonly LoopLaneOutcome[], batchTitles?: BatchTitles): GapRow[] {
  const out: GapRow[] = [];
  const keyOf = gapKey;
  const byKey = new Map<string, GapRow>();
  const push = (row: GapRow) => {
    const dup = byKey.get(keyOf(row));
    if (dup) {
      dup.covers = [...new Set([...dup.covers, ...row.covers])];
      dup.evidence = dup.evidence ?? row.evidence;
      dup.review = dup.review ?? row.review;
      if (row.state === "committed") dup.state = "committed";
      if (row.verified) dup.verified = true;
      return;
    }
    byKey.set(keyOf(row), row);
    out.push(row);
  };

  const markers: { cover: string; review: NonNullable<LaneDeliverable["review"]> }[] = [];
  for (const o of lanes) {
    const closed = new Set(o.closedFollowUpIds);
    for (const d of o.deliverables ?? []) {
      if (isReviewMarker(d)) {
        if (d.review) markers.push({ cover: d.covers[0]!, review: d.review });
        continue;
      }
      // A `closed` row is verified only when the rescan named it. Attributable movement is not
      // a per-item close (G13): do not fold a claim into Closed.
      const verified = d.kind === "closed" && !d.retired && d.covers.some((id) => closed.has(id));
      push({
        ...d,
        covers: [...d.covers],
        state: stateOf(d, o),
        laneId: o.lane.id,
        ...(verified ? { verified: true as const } : {}),
      });
    }
  }
  // THE ARMED-BUT-UNRESOLVED BATCH ITEMS — proposed rows, titled from the follow-up itself.
  //
  // FOUR PLACES ARE ASKED FOR A TITLE, because the first one fails for exactly the lanes that most
  // need a row. A lane's `before`/`after` scans are the natural lookup and a FORCE-FAILED or still-
  // queued lane HAS NEITHER — it never got as far as a rescan — so every one of its dispatched items
  // used to print its raw uuid in the sheet's frozen column and again in the Proposals ledger. So:
  // the pair's own recommendations, then the diff's closed-and-moved rows, then the lane's persisted
  // deliverables (a headline whose `covers` names the id), then the run's `batchTitles` — the
  // server-side resolution against the `Recommendation` table itself, which is the one source that
  // does not depend on this lane having survived. Only then the placeholder.
  for (const o of lanes) {
    const closed = new Set(o.closedFollowUpIds);
    const titles = new Map<string, string>();
    for (const r of [...(o.after?.recommendations ?? []), ...(o.before?.recommendations ?? [])]) {
      if (!titles.has(r.id)) titles.set(r.id, r.title);
    }
    for (const r of o.diff?.recsMovedToDone ?? []) if (!titles.has(r.id)) titles.set(r.id, r.title);
    for (const d of o.deliverables ?? []) {
      if (isReviewMarker(d)) continue;
      for (const id of d.covers) if (!titles.has(id) && d.covers.length === 1) titles.set(id, d.headline);
    }
    for (const id of o.lane.batchIds) {
      if (closed.has(id) || byKey.has(`id|${id}`)) continue;
      const fromRun = batchTitles?.[id];
      const headline = titles.get(id) ?? fromRun?.title ?? untitledBatchItem(id);
      push({
        headline,
        dimId: fromRun?.dimId && isDimensionId(fromRun.dimId) ? fromRun.dimId : null,
        kind: "noted",
        covers: [id],
        evidence: null,
        state: "proposed",
        laneId: o.lane.id,
      });
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
