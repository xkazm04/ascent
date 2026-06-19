// Fleet-level signals from each repo's latest scan: pull-request stats (prStats), default-branch
// governance, and commit-activity trend (Deepen-F3). All guarded by DATABASE_URL.

import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { segmentScope } from "@/lib/db/org-shared";
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
export async function getOrgPrSignals(orgSlug: string, segmentId?: string | null): Promise<OrgPrSignals | null> {
  if (!isDbConfigured()) return null;
  const prisma = getPrisma();
  const org = await prisma.organization.findUnique({ where: { slug: orgSlug } });
  if (!org) return null;

  const repos = await prisma.repository.findMany({
    where: { orgId: org.id, ...segmentScope(segmentId) },
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

  const mean = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0);
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
export async function getOrgGovernance(orgSlug: string, segmentId?: string | null): Promise<OrgGovernance | null> {
  if (!isDbConfigured()) return null;
  const prisma = getPrisma();
  const org = await prisma.organization.findUnique({ where: { slug: orgSlug } });
  if (!org) return null;

  const repos = await prisma.repository.findMany({
    where: { orgId: org.id, ...segmentScope(segmentId) },
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

/** Fleet commit-activity trend — element-wise sum of each repo's latest weekly series. */
export async function getOrgActivity(orgSlug: string, segmentId?: string | null): Promise<OrgActivity | null> {
  if (!isDbConfigured()) return null;
  const prisma = getPrisma();
  const org = await prisma.organization.findUnique({ where: { slug: orgSlug } });
  if (!org) return null;

  const repos = await prisma.repository.findMany({
    where: { orgId: org.id, ...segmentScope(segmentId) },
    select: { scans: { orderBy: { scannedAt: "desc" }, take: 1, select: { commitActivity: true } } },
  });

  const seriesList: number[][] = [];
  for (const r of repos) {
    const raw = r.scans[0]?.commitActivity;
    if (!raw) continue;
    try {
      const arr = JSON.parse(raw) as number[];
      if (Array.isArray(arr) && arr.length) seriesList.push(arr);
    } catch {
      /* ignore */
    }
  }
  if (!seriesList.length) return null;

  // Align by most-recent week (last element) and sum.
  const maxLen = Math.max(...seriesList.map((s) => s.length));
  const series = new Array(maxLen).fill(0);
  for (const s of seriesList) {
    const offset = maxLen - s.length;
    for (let i = 0; i < s.length; i++) series[offset + i] += s[i];
  }
  return { weeks: maxLen, series, total: series.reduce((a, b) => a + b, 0), repos: seriesList.length };
}
