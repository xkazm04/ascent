// A PLAN'S ITEMS, RE-RESOLVED TO TODAY'S ROWS (spark theater-upgrade, 2026-09-18; WP3).
//
// A plan stores its items by DURABLE key (`recommendationDecisionKey(repo, dimId, title)`), because
// the Recommendation rows it was written about are recreated on every scan. Executing or rejecting a
// plan days later therefore starts here: today's open rows for the repo — gaps from the org backlog,
// craft rungs from the craft read, the same two sources `openBatch` draws from — indexed by that key.
// A key with no row today is an item the scans stopped raising (closed, dismissed, reworded): it is
// dropped, never guessed back into existence.

import { getOrgBacklog } from "@/lib/db/org-insights";
import { getCraftItems } from "@/lib/db/org-insights-craft";
import type { FollowUpItem } from "@/lib/org/followups";
import { recommendationDecisionKey } from "@/lib/report/rec-identity";

/** The durable key of a follow-up — the one `openBatch`'s held-item exclusion computes. */
export const followUpKey = (repo: string, it: { dimId?: string | null; title: string }): string =>
  recommendationDecisionKey(repo, it.dimId ?? "", it.title);

/** Today's OPEN rows for one repo, by durable key. Gaps first; a craft rung never shadows a gap. */
export async function openItemsByKey(org: string, repo: string): Promise<Map<string, FollowUpItem>> {
  const out = new Map<string, FollowUpItem>();
  const backlog = await getOrgBacklog(org, null, new Date(), null);
  for (const it of backlog?.byOwner.flatMap((g) => g.items) ?? []) {
    if (it.repo !== repo || it.status !== "open") continue;
    const key = followUpKey(repo, it);
    if (out.has(key)) continue;
    out.set(key, {
      id: it.id,
      repo: it.repo,
      title: it.title,
      dimId: it.dimId,
      dimLabel: it.dimLabel,
      impact: it.impact,
      effort: it.effort,
      rationale: it.rationale,
      explore: it.explore,
      projectedPoints: it.projectedPoints,
    });
  }
  for (const it of await getCraftItems(org, repo, 500).catch(() => [] as FollowUpItem[])) {
    const key = followUpKey(repo, it);
    if (!out.has(key)) out.set(key, it);
  }
  return out;
}
