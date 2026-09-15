// THE PROPOSALS QUEUE — pure. One decision ledger over two sources of proposed work:
//
//   scan — the follow-ups a scan left open (the ledger the Follow-ups tab used to be). Decided by
//          handing a batch to an agent, or by resolving / dismissing it by hand.
//   loop — what a loop run ARMED but did not resolve, and nobody has ruled on yet: the `proposed`
//          rows of the Live tab's outcome sheet with no review. Decided by approving or dismissing
//          it — the same `review` write the sheet's ✓/✕ makes.
//
// The two share the row vocabulary (repo · dimension · headline · age) and the filters, so a reader
// works one queue instead of two tabs. What they do NOT share is kept honest: a loop proposal has no
// impact/effort rating, no projected points and no fleet spread, so an Impact or org-wide filter
// excludes it rather than guessing.

import type { LoopRunDetail, LoopLaneOutcome } from "@/lib/db/loop-runs-types";
import { buildGapRows, gapKey, rowCover, type DeliverableState } from "@/features/inflight/live/outcome/outcomeGapRows";
import { applyFilters, type DimensionSpread, type FollowUpFilters, type FollowUpRow } from "@/components/org/followups/followupsModel";

export type ScanProposal = FollowUpRow & { source: "scan" };

export interface LoopProposal {
  source: "loop";
  /** `<runId>:<laneId>:<cover>` — stable across refetches of the same run. */
  id: string;
  runId: string;
  /** The review POST's address and key — exactly what the outcome sheet sends. */
  laneId: string;
  cover: string;
  repo: string;
  repoName: string;
  dimId: string | null;
  title: string;
  evidence: string | null;
  state: DeliverableState;
  /** ISO — when the run that armed it started. */
  proposedAt: string;
}

export type ProposalRow = ScanProposal | LoopProposal;
export type ProposalSource = ProposalRow["source"];

export const SOURCE_LABEL: Record<ProposalSource, string> = { scan: "scan follow-ups", loop: "loop proposals" };

export const isScanProposal = (r: ProposalRow): r is ScanProposal => r.source === "scan";
export const isLoopProposal = (r: ProposalRow): r is LoopProposal => r.source === "loop";

/**
 * The loop's pending proposals across the given run details, newest run first.
 *
 * A gap is judged by its LATEST appearance: the same gap proposed in run 3 and again in run 7 is one
 * row (run 7's), and a ruling on run 7's row settles it — run 3's older, unruled copy does not
 * resurface. Only `proposed` rows qualify; committed and uncommitted work is an outcome to read on
 * the Live tab, not a proposal awaiting a yes.
 */
export function pendingLoopProposals(details: readonly LoopRunDetail[]): LoopProposal[] {
  const newestFirst = [...details].sort((a, b) => b.run.startedAt.localeCompare(a.run.startedAt));
  const seen = new Set<string>();
  const out: LoopProposal[] = [];
  for (const d of newestFirst) {
    const byRepo = new Map<string, LoopLaneOutcome[]>();
    for (const o of d.outcomes) byRepo.set(o.lane.repoFullName, [...(byRepo.get(o.lane.repoFullName) ?? []), o]);
    for (const [repo, lanes] of byRepo) {
      for (const row of buildGapRows(lanes)) {
        const key = `${repo}|${gapKey(row)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (row.state !== "proposed" || row.review) continue;
        const cover = rowCover(row);
        out.push({
          source: "loop",
          id: `${d.run.id}:${row.laneId}:${cover}`,
          runId: d.run.id,
          laneId: row.laneId,
          cover,
          repo,
          repoName: repo.split("/").pop() ?? repo,
          dimId: row.dimId,
          title: row.headline,
          evidence: row.evidence && row.evidence !== row.headline ? row.evidence : null,
          state: row.state,
          proposedAt: d.run.startedAt,
        });
      }
    }
  }
  return out;
}

/** Loop proposals first — work already done, waiting on a yes — then the scan ledger in its value order. */
export function mergeProposals(followups: readonly FollowUpRow[], loop: readonly LoopProposal[]): ProposalRow[] {
  return [...loop, ...followups.map((r): ScanProposal => ({ ...r, source: "scan" }))];
}

/**
 * The ledger's filters over both sources. Scan rows go through the follow-ups model's own
 * `applyFilters` unchanged; a loop proposal is pending by construction, so it belongs to the working
 * set and never to the resolved archive, and it carries no impact rating and no fleet spread.
 */
export function applyProposalFilters(
  rows: readonly ProposalRow[],
  f: FollowUpFilters,
  sources: ReadonlySet<string>,
  spread?: Map<string, DimensionSpread>,
): ProposalRow[] {
  const keptScan = new Set(applyFilters(rows.filter(isScanProposal), f, spread).map((r) => r.id));
  const q = f.query.trim().toLowerCase();
  return rows.filter((r) => {
    if (sources.size > 0 && !sources.has(r.source)) return false;
    if (r.source === "scan") return keptScan.has(r.id);
    if (f.statuses.size > 0 && !f.statuses.has("open")) return false;
    if (f.impacts.size > 0 || f.orgWide) return false;
    if (f.repos.size > 0 && !f.repos.has(r.repo)) return false;
    if (f.dims.size > 0 && !(r.dimId && f.dims.has(r.dimId))) return false;
    if (q && !`${r.title} ${r.evidence ?? ""} ${r.repo}`.toLowerCase().includes(q)) return false;
    return true;
  });
}
