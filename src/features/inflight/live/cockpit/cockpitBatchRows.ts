// THE PROPOSED BATCH, AS LEDGER ROWS — the pure fold behind `CockpitBatchLedger`.
//
// The batch used to render as one bordered card per repo with a checkbox list inside it, stacked in
// the rail. As a LEDGER it is one flat row per dispatchable item, the way every other queue in the In
// flight group reads (Proposals, Lessons): repo · dimension · what it is · impact/effort · projected
// points, ticked or untricked. A reader can then compare two repos' rows, which nested cards never
// allowed, and sort/scan by dimension rather than by whichever repo happens to be first.
//
// TWO ROWS ARE NOT ITEMS AND SAY SO IN THEIR OWN WORDS:
//   • a LANE row — a `foundation` / `practice` / `craft` lane whose work IS an install, so there is
//     nothing for an operator to curate. It carries the lane's reason, not a checkbox.
//   • an UNPAIRED row — a selected repo with no local working copy. Flagged and excluded, never
//     silently dropped: a lasso that caught one unpaired repo must say which.
//
// Pure, so the arithmetic under the ledger (what will actually dispatch) is pinnable without a DOM.

import type { FollowUpItem, LoopProposal } from "./loopTypes";
import { laneKindTag } from "./loopTypes";

export type BatchRow =
  | { kind: "item"; id: string; repo: string; repoName: string; laneTag: string | null; item: FollowUpItem }
  | { kind: "lane"; id: string; repo: string; repoName: string; laneTag: string | null; note: string; curation: string | null }
  | { kind: "unpaired"; id: string; repo: string; repoName: string; laneTag: null; note: string; curation: null };

const shortRepo = (repo: string): string => repo.split("/")[1] ?? repo;

/**
 * The proposals, flattened into ledger rows under the current dimension focus.
 *
 * `unpaired` wins over everything: a repo with no local pairing cannot run whatever it proposed, so
 * printing its items as tickable would offer a curation that changes nothing.
 */
export function batchRows(
  proposals: readonly LoopProposal[],
  unpaired: ReadonlySet<string>,
  dimFocus: string | null,
): BatchRow[] {
  const out: BatchRow[] = [];
  for (const p of proposals) {
    const repoName = shortRepo(p.repo);
    const tag = laneKindTag(p.kind);
    if (unpaired.has(p.repo)) {
      out.push({ kind: "unpaired", id: `unpaired:${p.repo}`, repo: p.repo, repoName, laneTag: null, note: "not paired · skipped", curation: null });
      continue;
    }
    const items = dimFocus ? p.items.filter((i) => i.dimId === dimFocus) : p.items;
    if (items.length === 0) {
      out.push({
        kind: "lane",
        id: `lane:${p.repo}`,
        repo: p.repo,
        repoName,
        laneTag: tag,
        // A tagged lane installs files and explains itself with the reason the proposer gave; an
        // untagged one with nothing in focus has simply nothing open here, and says that instead.
        note: tag ? p.reason : dimFocus ? "nothing open on this dimension" : "nothing open here",
        // …and a tagged lane's work IS the install, so it says out loud that there is nothing here to
        // tick. Without it the row reads like an agent lane whose backlog came back empty.
        curation: tag ? "no rows to curate — this lane installs files" : null,
      });
      continue;
    }
    for (const item of items) out.push({ kind: "item", id: item.id, repo: p.repo, repoName, laneTag: tag, item });
  }
  return out;
}

export interface BatchTotals {
  /** Items that will be dispatched — ticked, in focus, in a paired repo. */
  items: number;
  /** Items in the ledger the operator has pruned out. */
  pruned: number;
  repos: number;
  /** Projected overall-score points if every dispatched item closes. Craft rungs carry none. */
  points: number;
  /** Selected repos excluded for want of a local pairing. */
  unpaired: number;
}

export function batchTotals(rows: readonly BatchRow[], pruned: ReadonlySet<string>): BatchTotals {
  const repos = new Set<string>();
  let items = 0;
  let prunedCount = 0;
  let points = 0;
  let unpaired = 0;
  for (const row of rows) {
    if (row.kind === "unpaired") {
      unpaired += 1;
      continue;
    }
    if (row.kind === "lane") {
      if (row.laneTag) repos.add(row.repo);
      continue;
    }
    if (pruned.has(row.id)) {
      prunedCount += 1;
      continue;
    }
    items += 1;
    repos.add(row.repo);
    points += row.item.projectedPoints ?? 0;
  }
  return { items, pruned: prunedCount, repos: repos.size, points, unpaired };
}
