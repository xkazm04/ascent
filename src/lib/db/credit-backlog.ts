// The credit backlog read (credits-1): one bounded, org-constrained read of the org's recent rescore
// ScanJob rows, folded by the pure credit-backlog-model to "watched repos whose newest rescore job was
// skipped for credits". Every timestamp leaves this module as an ISO string (wire-safe.ts).

import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { getOrgId } from "@/lib/db/org-rollup";
import { listWatchedRepos } from "@/lib/db/org-watch";
import { foldCreditBacklog, type CreditBacklog, type CreditSkipJob } from "@/lib/credit-backlog-model";

/** How far back a skip is still news. Longer than the slowest cadence (monthly), so a monthly repo's
 *  skip stays visible until its next run; older rows also sit past the queue's purge horizon. */
export const CREDIT_BACKLOG_WINDOW_DAYS = 35;
/** Row bound for the read: a fleet's rescore jobs over the window, newest first. */
const MAX_JOBS = 2000;

const EMPTY: CreditBacklog = { count: 0, repos: [], oldestSkippedAt: null };

export async function getCreditBacklog(orgSlug: string, nowMs: number = Date.now()): Promise<CreditBacklog> {
  if (!isDbConfigured()) return EMPTY;
  const orgId = await getOrgId(orgSlug);
  if (!orgId) return EMPTY;
  const since = new Date(nowMs - CREDIT_BACKLOG_WINDOW_DAYS * 86_400_000);
  const [rows, watched] = await Promise.all([
    getPrisma().scanJob.findMany({
      where: { orgId, lane: "rescore", updatedAt: { gte: since } },
      select: { repoFullName: true, lane: true, reason: true, state: true, error: true, settledAt: true, updatedAt: true },
      orderBy: { updatedAt: "desc" },
      take: MAX_JOBS,
    }) as Promise<
      { repoFullName: string; lane: string; reason: string; state: string; error: string | null; settledAt: Date | null; updatedAt: Date }[]
    >,
    listWatchedRepos(orgSlug),
  ]);
  // Only WATCHED repos are owed: POST /api/org/scan intersects its `repos` with the watchlist, so an
  // unwatched repo in the list would be a promise the resume click cannot keep.
  const lastScanAt: Record<string, string | null> = {};
  for (const r of watched) lastScanAt[r.fullName.toLowerCase()] = r.lastScanAt ?? null;
  const jobs: CreditSkipJob[] = rows
    .filter((r) => r.repoFullName.toLowerCase() in lastScanAt)
    .map((r) => ({
      repoFullName: r.repoFullName,
      lane: r.lane,
      reason: r.reason,
      state: r.state,
      error: r.error,
      at: (r.settledAt ?? r.updatedAt).toISOString(),
    }));
  return foldCreditBacklog(jobs, lastScanAt);
}
