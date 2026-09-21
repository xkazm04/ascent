// THE RUNNER'S SPEND READ — what the org's lanes have cost since a moment (local midnight, for the
// spend-ceiling breaker in src/lib/local/runner-breakers.ts). Spark theater-upgrade, 2026-09-18; WP2.
//
// LEAN ON PURPOSE: one aggregate over `LoopRunLane.costMicros`, joined to the org through the lane's
// run. It is read before every run the standing runner dispatches, and it must not grow into the
// economics fold (`getOrgPriceList`), which prices, groups and compares — none of which a yes/no on a
// ceiling needs.
//
// WHOSE SPEND: every lane of the org that ENDED in the window — the runner's and a manual run's alike,
// because the ceiling is about the account's money, not about which button spent it. A lane still in
// flight has not reported its cost yet and is not counted until it ends; a lane whose cost is unknown
// (null) adds nothing, which is the honest reading of "unknown" for a sum and is why the ceiling is a
// floor on caution rather than an exact meter.

import { dbReadSafe, getPrisma, isDbConfigured } from "@/lib/db/client";
import { getOrgBySlug } from "@/lib/db/org-shared";

/** Micro-cents the org's lanes that ended at or after `since` cost. Null when there is no database or
 *  no such org — "unknown", which the breaker reads as "no reading", never as zero spend. */
export async function orgLaneSpendSince(orgSlug: string, since: Date): Promise<number | null> {
  if (!isDbConfigured()) return null;
  return dbReadSafe<number | null>(async () => {
    const org = await getOrgBySlug(orgSlug.trim().toLowerCase());
    if (!org) return null;
    const agg = await getPrisma().loopRunLane.aggregate({
      where: { endedAt: { gte: since }, run: { orgId: org.id } },
      _sum: { costMicros: true },
    });
    return Number(agg._sum.costMicros ?? 0);
  }, null);
}
