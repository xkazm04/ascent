// A cell's DELIVERABLES — the headline rows (`LaneDeliverable`, produced server-side by
// src/lib/local/lane-deliverables.ts and backfilled on read) folded across a repo's lanes, plus the
// full follow-up titles kept as evidence. Pure; split out of outcomeMatrix.ts for the 200-line cap.

import type { LaneDeliverable, LaneDeliverableKind } from "@/lib/db/loop-runs-types";
import type { LoopLaneOutcome } from "../cockpit/loopTypes";

/** The order a cell lists its deliverables in: what was closed, then installed, then what moved. */
export const DELIVERABLE_KIND_ORDER: readonly LaneDeliverableKind[] = ["closed", "installed", "hardened", "regressed", "noted"];

/** Every lane's deliverables, deduped by (dimId, headline) with their `covers` merged, in kind order
 *  then dimension order. */
export function groupDeliverables(lanes: readonly LoopLaneOutcome[]): LaneDeliverable[] {
  const byKey = new Map<string, LaneDeliverable>();
  for (const o of lanes) {
    for (const d of o.deliverables ?? []) {
      const key = `${d.dimId ?? ""}|${d.headline.trim().toLowerCase()}`;
      const dup = byKey.get(key);
      if (dup) byKey.set(key, { ...dup, covers: [...new Set([...dup.covers, ...d.covers])], evidence: dup.evidence ?? d.evidence });
      else byKey.set(key, { ...d, covers: [...d.covers] });
    }
  }
  const rank = (k: LaneDeliverableKind) => DELIVERABLE_KIND_ORDER.indexOf(k);
  return [...byKey.values()].sort((a, b) => rank(a.kind) - rank(b.kind) || (a.dimId ?? "D~").localeCompare(b.dimId ?? "D~"));
}

/** The full titles behind a lane's closes — recs moved to done plus closed follow-up ids resolved to
 *  titles, deduped. Evidence for the expanded view; the headline rows above are what the cell prints. */
export function closedTitles(o: LoopLaneOutcome): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (t: string) => {
    const k = t.trim().toLowerCase();
    if (k && !seen.has(k)) {
      seen.add(k);
      out.push(t.trim());
    }
  };
  for (const r of o.diff?.recsMovedToDone ?? []) push(r.title);
  const byId = new Map<string, string>();
  for (const r of [...(o.after?.recommendations ?? []), ...(o.before?.recommendations ?? [])]) byId.set(r.id, r.title);
  for (const id of o.closedFollowUpIds) {
    const t = byId.get(id);
    if (t) push(t);
  }
  return out;
}
