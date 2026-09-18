// A cell's DELIVERABLES — the headline rows (`LaneDeliverable`, produced server-side by
// src/lib/local/lane-deliverables.ts and backfilled on read) folded across a repo's lanes, plus the
// full follow-up titles kept as evidence. Pure; split out of outcomeMatrix.ts for the 200-line cap.

import { isReviewMarker, type LaneDeliverable, type LaneDeliverableKind } from "@/lib/db/loop-runs-types";
import type { LoopLaneOutcome } from "../cockpit/loopTypes";

/** The order a cell lists its deliverables in: what was closed, then installed, then what moved. */
export const DELIVERABLE_KIND_ORDER: readonly LaneDeliverableKind[] = ["closed", "installed", "hardened", "regressed", "noted"];

/** Every lane's deliverables, deduped by (dimId, headline) with their `covers` merged, in kind order
 *  then dimension order. */
export function groupDeliverables(lanes: readonly LoopLaneOutcome[]): LaneDeliverable[] {
  const byKey = new Map<string, LaneDeliverable>();
  for (const o of lanes) {
    for (const d of o.deliverables ?? []) {
      if (isReviewMarker(d)) continue; // a marker carries a ruling, not a deliverable — never a row
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

/** How each kind reads on a row: the glyph the sheet cell leads with, and the label behind it. */
export const KIND_META: Record<LaneDeliverableKind, { label: string; glyph: string }> = {
  closed: { label: "Closed", glyph: "✓" },
  installed: { label: "Installed", glyph: "+" },
  hardened: { label: "Hardened", glyph: "▲" },
  regressed: { label: "Regressed", glyph: "▼" },
  // `noted` rows are the armed-but-unresolved batch items (outcomeGapRows.ts) — proposals.
  noted: { label: "Proposed", glyph: "·" },
};

/** Glyph, label, and optional tone/note a sheet cell leads with. */
export type RowMeta = { label: string; glyph: string; tone?: string; note?: string };

/**
 * How a row PRESENTS, once `retired` and `verified` are taken into account.
 *
 * Both are flags rather than extra kinds (`LaneDeliverable.retired`, and `verified` stamped onto
 * the gap row at fold time), so they have to be resolved at render time.
 *
 * `retired` marks a row the RESCAN stopped raising rather than one the agent claimed — one run
 * retired nine phantom follow-ups off a single commit, and printing those as "Closed" overstated
 * the run's output by an order of magnitude. A retirement is real bookkeeping and still earns a
 * row; it just must not wear the same tick as work someone did.
 *
 * `verified` is the same shape for a different split: a `closed` row is an agent's CLAIM until the
 * rescan names it in `closedFollowUpIds`. Printing those as "Closed" is the sheet-side of the
 * tautology CockpitVerdicts already split ("claimed resolved — awaiting the rescan" vs "closed by
 * the rescan"). Missing `verified` is unverified — the safe direction for a trust flag.
 */
export function rowMeta(d: Pick<LaneDeliverable, "kind" | "retired"> & { verified?: boolean }): RowMeta {
  if (d.retired) return { label: "Retired", glyph: "–" };
  if (d.kind === "closed" && !d.verified) {
    return {
      label: "Claimed",
      glyph: "~",
      tone: "italic text-slate-400",
      note: "The agent claimed this resolved. The rescan has not confirmed it.",
    };
  }
  return KIND_META[d.kind];
}
