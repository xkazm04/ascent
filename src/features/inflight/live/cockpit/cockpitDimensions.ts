// The inspector's SHARED-DIMENSION math: across the repos the operator has selected, which maturity
// dimensions does the proposed work actually land on, and how widely?
//
// This is the one number in the cockpit that answers a fleet question rather than a repo question —
// "D2 is open in 7 of 12" is a statement about the org, and it is the reason a batch of twelve lanes
// is worth running at once instead of twelve times separately. Pure, so the "of N" denominator (the
// SELECTED repos that have a proposal at all — never the whole fleet, which would quietly deflate
// every share) is pinned by a test rather than by whichever component last touched it.

import { dimShort } from "@/lib/ui";
import type { LoopProposal } from "./loopTypes";

export interface DimensionShare {
  dimId: string;
  label: string;
  /** Selected repos with at least one open item in this dimension. */
  repos: number;
  /** Proposed items in this dimension across those repos. */
  items: number;
  /** Summed projected points of those items. */
  points: number;
  /** repos / total, 0–1 — the bar's fill. */
  share: number;
}

export interface SharedDimensions {
  /** Selected repos that have a proposal (the denominator every share is over). */
  total: number;
  rows: DimensionShare[];
}

/**
 * Fold the proposals for the selected repos into per-dimension shares, widest first.
 * A repo counts ONCE per dimension however many items it has there — the bar is about spread.
 */
export function sharedDimensions(
  proposals: readonly LoopProposal[],
  selected: ReadonlySet<string>,
): SharedDimensions {
  const scoped = proposals.filter((p) => selected.has(p.repo));
  const byDim = new Map<string, { repos: Set<string>; items: number; points: number; label: string }>();
  for (const p of scoped) {
    for (const item of p.items) {
      let row = byDim.get(item.dimId);
      if (!row) {
        row = { repos: new Set(), items: 0, points: 0, label: item.dimLabel || dimShort(item.dimId) };
        byDim.set(item.dimId, row);
      }
      row.repos.add(p.repo);
      row.items += 1;
      row.points += item.projectedPoints ?? 0;
    }
  }
  const total = scoped.length;
  const rows = [...byDim.entries()]
    .map(([dimId, r]) => ({
      dimId,
      label: r.label,
      repos: r.repos.size,
      items: r.items,
      points: r.points,
      share: total > 0 ? r.repos.size / total : 0,
    }))
    .sort((a, b) => b.repos - a.repos || b.points - a.points || a.dimId.localeCompare(b.dimId));
  return { total, rows };
}

/**
 * Is this dimension an ORG-WIDE call rather than one repo's chore? True at half the selected repos
 * or more, and never for a selection of one (where "1 of 1" is a tautology, not a finding).
 */
export const isOrgWide = (row: DimensionShare, total: number): boolean => total > 1 && row.repos * 2 >= total;

/** The call line the inspector prints beside an org-wide bar. */
export const shareLine = (row: DimensionShare, total: number): string =>
  `${row.dimId} open in ${row.repos} of ${total}`;

/** Every dimension present in the proposals, for the "dimension focus" select. */
export function proposalDimensions(proposals: readonly LoopProposal[]): { id: string; label: string }[] {
  const seen = new Map<string, string>();
  for (const p of proposals) for (const i of p.items) if (!seen.has(i.dimId)) seen.set(i.dimId, i.dimLabel || dimShort(i.dimId));
  return [...seen.entries()].map(([id, label]) => ({ id, label })).sort((a, b) => a.id.localeCompare(b.id));
}
