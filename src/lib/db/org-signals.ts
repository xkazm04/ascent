// Fleet-level signals from each repo's latest scan: pull-request stats (prStats), default-branch
// governance, and commit-activity trend (Deepen-F3). All guarded by DATABASE_URL.

import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { roundedMean, segmentScope, techGroupScope } from "@/lib/db/org-shared";
import type { PrStats } from "@/lib/types";

export interface OrgPrSignals {
  repos: number; // repos that have PR data
  totalPrs: number; // PRs analyzed across the fleet
  avgMergeRate: number;
  avgReviewedRate: number | null; // mean of repo reviewedRate (where a human-merged sample exists)
  avgSmallPrRate: number;
  avgAiInvolvedRate: number;
  avgAiGovernedRate: number | null; // mean of repo aiGovernedRate (where it has a sample)
  typicalHoursToMerge: number | null; // mean of per-repo medians
  tools: { name: string; count: number }[];
}

/** Fleet-level pull-request signals — aggregated from each repo's latest scan's prStats. */
export async function getOrgPrSignals(orgSlug: string, segmentId?: string | null, techGroupId?: string | null): Promise<OrgPrSignals | null> {
  if (!isDbConfigured()) return null;
  const prisma = getPrisma();
  const org = await prisma.organization.findUnique({ where: { slug: orgSlug } });
  if (!org) return null;

  const repos = await prisma.repository.findMany({
    where: { orgId: org.id, ...segmentScope(segmentId), ...techGroupScope(techGroupId) },
    select: { scans: { orderBy: { scannedAt: "desc" }, take: 1, select: { prStats: true } } },
  });

  const stats: PrStats[] = [];
  for (const r of repos) {
    const raw = r.scans[0]?.prStats;
    if (!raw) continue;
    try {
      const p = JSON.parse(raw) as PrStats;
      if (p.analyzed > 0) stats.push(p);
    } catch {
      /* ignore malformed */
    }
  }
  if (!stats.length) return null;

  const mean = roundedMean;
  const ttm = stats.map((s) => s.medianHoursToMerge).filter((x): x is number => x != null);
  const governed = stats.map((s) => s.aiGovernedRate).filter((x): x is number => x != null);
  const reviewed = stats.map((s) => s.reviewedRate).filter((x): x is number => x != null);
  const toolMap = new Map<string, number>();
  for (const s of stats) for (const t of s.tools) toolMap.set(t.name, (toolMap.get(t.name) ?? 0) + t.count);

  return {
    repos: stats.length,
    totalPrs: stats.reduce((a, s) => a + s.analyzed, 0),
    avgMergeRate: mean(stats.map((s) => s.mergeRate)),
    avgReviewedRate: reviewed.length ? mean(reviewed) : null,
    avgSmallPrRate: mean(stats.map((s) => s.smallPrRate)),
    avgAiInvolvedRate: mean(stats.map((s) => s.aiInvolvedRate)),
    avgAiGovernedRate: governed.length ? mean(governed) : null,
    typicalHoursToMerge: ttm.length ? Math.round((ttm.reduce((a, b) => a + b, 0) / ttm.length) * 10) / 10 : null,
    tools: [...toolMap.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
  };
}

// ── Deepen-F3: governance + activity aggregates ───────────────────────────────

export interface RepoGovernance {
  fullName: string;
  name: string;
  protected: boolean;
  requiresPullRequest: boolean;
  requiredApprovals: number;
  requiresStatusChecks: boolean;
  requiresSignatures: boolean;
  ruleCount: number;
}

export interface OrgGovernance {
  repos: number; // repos with readable governance
  protectedRate: number;
  requireReviewRate: number;
  requireChecksRate: number;
  signedRate: number;
  perRepo: RepoGovernance[]; // sorted: least-protected first (risk surfaced)
}

/** Fleet default-branch governance — from each repo's latest scan's `governance` JSON. */
export async function getOrgGovernance(orgSlug: string, segmentId?: string | null, techGroupId?: string | null): Promise<OrgGovernance | null> {
  if (!isDbConfigured()) return null;
  const prisma = getPrisma();
  const org = await prisma.organization.findUnique({ where: { slug: orgSlug } });
  if (!org) return null;

  const repos = await prisma.repository.findMany({
    where: { orgId: org.id, ...segmentScope(segmentId), ...techGroupScope(techGroupId) },
    select: { fullName: true, name: true, scans: { orderBy: { scannedAt: "desc" }, take: 1, select: { governance: true } } },
  });

  const perRepo: RepoGovernance[] = [];
  for (const r of repos) {
    const raw = r.scans[0]?.governance;
    if (!raw) continue;
    try {
      const g = JSON.parse(raw) as {
        protected: boolean;
        requiresPullRequest: boolean;
        requiredApprovals: number;
        requiresStatusChecks: boolean;
        requiresSignatures: boolean;
        ruleCount: number;
        readable: boolean;
      };
      if (!g.readable) continue;
      perRepo.push({
        fullName: r.fullName,
        name: r.name,
        protected: g.protected,
        requiresPullRequest: g.requiresPullRequest,
        requiredApprovals: g.requiredApprovals,
        requiresStatusChecks: g.requiresStatusChecks,
        requiresSignatures: g.requiresSignatures,
        ruleCount: g.ruleCount,
      });
    } catch {
      /* ignore */
    }
  }
  if (!perRepo.length) return null;

  const rate = (pred: (g: RepoGovernance) => boolean) => Math.round((perRepo.filter(pred).length / perRepo.length) * 100);
  // Risk-first: unprotected repos, then fewest rules.
  perRepo.sort((a, b) => Number(a.protected) - Number(b.protected) || a.ruleCount - b.ruleCount);
  return {
    repos: perRepo.length,
    protectedRate: rate((g) => g.protected),
    // "Require review" must mean an APPROVAL is required (required_approving_review_count ≥ 1), not
    // merely that a PR is required to merge — a PR-required branch with 0 required approvals lets the
    // author self-merge unreviewed. Counting requiresPullRequest overstated approval-enforced coverage.
    requireReviewRate: rate((g) => g.requiredApprovals >= 1),
    requireChecksRate: rate((g) => g.requiresStatusChecks),
    signedRate: rate((g) => g.requiresSignatures),
    perRepo,
  };
}

export interface OrgActivity {
  weeks: number;
  series: number[]; // fleet weekly commit totals (sum across repos), oldest→newest
  total: number;
  repos: number;
}

const WEEK_MS = 7 * 86_400_000;

/** Whole-week index (weeks since the Unix epoch) of an instant. GitHub's commit_activity buckets are
 *  weekly, so two repos' series elements only belong in the same fleet bucket if they fall in the same
 *  absolute week — this maps an instant to that integer week so series can be aligned by calendar week
 *  rather than by array position. */
function weekIndex(ms: number): number {
  return Math.floor(ms / WEEK_MS);
}

/** Fleet commit-activity trend — sum of each repo's latest weekly series, aligned by absolute
 *  calendar week. */
export async function getOrgActivity(orgSlug: string, segmentId?: string | null, techGroupId?: string | null): Promise<OrgActivity | null> {
  if (!isDbConfigured()) return null;
  const prisma = getPrisma();
  const org = await prisma.organization.findUnique({ where: { slug: orgSlug } });
  if (!org) return null;

  const repos = await prisma.repository.findMany({
    where: { orgId: org.id, ...segmentScope(segmentId), ...techGroupScope(techGroupId) },
    // scannedAt anchors each trailing weekly series to a real calendar week (its last element is the
    // week of the scan), so different-cadence repos sum the SAME week, not the same array index.
    select: { scans: { orderBy: { scannedAt: "desc" }, take: 1, select: { commitActivity: true, scannedAt: true } } },
  });

  // Bug-fix (fleet-rollups-insights #1): each repo's commitActivity is GitHub's trailing weekly series
  // ending at its OWN scan week. The old "align by last element" sum assumed every repo was scanned in
  // the same week, so a repo scanned 4 weeks ago had its month-old "this week" double-counted into the
  // fleet's current week. Bucket each series element by its absolute calendar week (derived from the
  // scan time) and sum per week. When all repos ARE scanned in the same week this reduces to the old
  // right-aligned sum (identical output) — only heterogeneous-cadence fleets change.
  const byWeek = new Map<number, number>();
  let repoCount = 0;
  for (const r of repos) {
    const scan = r.scans[0];
    const raw = scan?.commitActivity;
    if (!raw) continue;
    try {
      const arr = JSON.parse(raw) as number[];
      if (!Array.isArray(arr) || !arr.length) continue;
      // The last element is the scan's own week; element i counts back (arr.length - 1 - i) weeks.
      const lastWeek = weekIndex(scan!.scannedAt.getTime());
      for (let i = 0; i < arr.length; i++) {
        const v = arr[i];
        if (typeof v !== "number" || !Number.isFinite(v)) continue;
        const wk = lastWeek - (arr.length - 1 - i);
        byWeek.set(wk, (byWeek.get(wk) ?? 0) + v);
      }
      repoCount += 1;
    } catch {
      /* ignore */
    }
  }
  if (!repoCount) return null;

  // Emit oldest→newest over a contiguous week grid (zero-filling any week no repo covered), so the
  // sparkline stays an evenly-spaced weekly series.
  const weeksPresent = [...byWeek.keys()];
  const minWk = Math.min(...weeksPresent);
  const maxWk = Math.max(...weeksPresent);
  const series: number[] = [];
  for (let wk = minWk; wk <= maxWk; wk++) series.push(byWeek.get(wk) ?? 0);
  return { weeks: series.length, series, total: series.reduce((a, b) => a + b, 0), repos: repoCount };
}
