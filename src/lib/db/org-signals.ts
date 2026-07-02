// Fleet-level signals from each repo's latest scan: pull-request stats (prStats), default-branch
// governance, and commit-activity trend (Deepen-F3). All guarded by DATABASE_URL.

import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { getOrgBySlug, roundedMean, segmentScope, techGroupScope } from "@/lib/db/org-shared";
import type { PrStats } from "@/lib/types";

/** One repo's PR-signal row for the delivery drill-down table. */
export interface PrRepoRow {
  fullName: string;
  name: string;
  analyzed: number;
  mergeRate: number;
  reviewedRate: number | null;
  smallPrRate: number;
  aiInvolvedRate: number;
  aiGovernedRate: number | null;
  medianHoursToMerge: number | null;
}

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
  perRepo: PrRepoRow[]; // sorted riskiest first: lowest review coverage, then slowest merges
}

/** Fleet-level pull-request signals — aggregated from each repo's latest scan's prStats. */
export async function getOrgPrSignals(orgSlug: string, segmentId?: string | null, techGroupId?: string | null): Promise<OrgPrSignals | null> {
  if (!isDbConfigured()) return null;
  const prisma = getPrisma();
  // Resolve through the shared cached resolver so a mixed-case slug canonicalizes (same identity the
  // auth gate uses) instead of missing the lower-cased org row and returning empty fleet data.
  const org = await getOrgBySlug(orgSlug);
  if (!org) return null;

  const repos = await prisma.repository.findMany({
    where: { orgId: org.id, ...segmentScope(segmentId), ...techGroupScope(techGroupId) },
    select: { fullName: true, name: true, scans: { orderBy: { scannedAt: "desc" }, take: 1, select: { prStats: true } } },
  });

  const stats: PrStats[] = [];
  const perRepo: PrRepoRow[] = [];
  for (const r of repos) {
    const raw = r.scans[0]?.prStats;
    if (!raw) continue;
    try {
      const p = JSON.parse(raw) as PrStats;
      if (p.analyzed > 0) {
        stats.push(p);
        perRepo.push({
          fullName: r.fullName,
          name: r.name,
          analyzed: p.analyzed,
          mergeRate: p.mergeRate,
          reviewedRate: p.reviewedRate,
          smallPrRate: p.smallPrRate,
          aiInvolvedRate: p.aiInvolvedRate,
          aiGovernedRate: p.aiGovernedRate,
          medianHoursToMerge: p.medianHoursToMerge,
        });
      }
    } catch {
      /* ignore malformed */
    }
  }
  if (!stats.length) return null;
  // Riskiest first, mirroring governance's risk-first sort: lowest review coverage leads, slowest
  // merges break ties. A null reviewedRate means "no human-merged sample" — not measured risk — so
  // those rows sort after every measured one instead of masquerading as 0% coverage.
  perRepo.sort(
    (a, b) =>
      (a.reviewedRate ?? Infinity) - (b.reviewedRate ?? Infinity) ||
      (b.medianHoursToMerge ?? -1) - (a.medianHoursToMerge ?? -1),
  );

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
    perRepo,
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
  // Resolve through the shared cached resolver so a mixed-case slug canonicalizes (same identity the
  // auth gate uses) instead of missing the lower-cased org row and returning empty fleet data.
  const org = await getOrgBySlug(orgSlug);
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
  /** UTC ms of the Sunday that starts the NEWEST bucket (series[series.length - 1]); each earlier
   *  element is exactly one WEEK_MS before it. Lets the chart label buckets with real dates. */
  endWeekStartMs: number;
  /** ISO date (YYYY-MM-DD) of the start of the most-recent / oldest week in `series`. The grid is
   *  anchored to the most recent SCAN (not the current calendar week) and zero-fills gaps, so axis
   *  labels must use these real week dates — the old "this week" / "{length} weeks ago" mislabelled a
   *  stale right edge and was off by one on the left. */
  latestWeekIso: string;
  oldestWeekIso: string;
}

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

/** Sunday-aligned whole-week index of an instant. GitHub's commit_activity buckets are Sunday-aligned
 *  weeks, so two repos' series elements only belong in the same fleet bucket if they fall in the same
 *  Sunday–Saturday week. A naive `floor(ms / WEEK_MS)` bins on the Unix-epoch 7-day grid, which is
 *  anchored on a THURSDAY — so two scans on opposite sides of a Thursday-00:00-UTC boundary WITHIN the
 *  same GitHub week land one bucket apart and their series sum out of phase. Instead, floor the instant
 *  to its Sunday 00:00 UTC first, then index; consecutive Sundays are 7 days apart, so the result stays
 *  a clean incrementing integer that different-cadence repos can be summed by. */
function weekIndex(ms: number): number {
  const d = new Date(ms);
  const utcMidnight = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const sundayMs = utcMidnight - d.getUTCDay() * DAY_MS; // getUTCDay(): 0 = Sunday
  return Math.floor(sundayMs / WEEK_MS);
}

/** Inverse of `weekIndex`: the UTC ms of the Sunday that starts week `wk`. Every Sunday-midnight
 *  since the epoch is (3 + 7k) days (Jan 1 1970 was a Thursday; the first Sunday was Jan 4 = day 3),
 *  so `weekIndex` maps it to k and this exact offset recovers the Sunday, not the epoch-grid Thursday. */
const SUNDAY_EPOCH_OFFSET_MS = 3 * DAY_MS;
function weekStartMs(wk: number): number {
  return wk * WEEK_MS + SUNDAY_EPOCH_OFFSET_MS;
}

/** Fleet commit-activity trend — sum of each repo's latest weekly series, aligned by absolute
 *  calendar week. */
export async function getOrgActivity(orgSlug: string, segmentId?: string | null, techGroupId?: string | null): Promise<OrgActivity | null> {
  if (!isDbConfigured()) return null;
  const prisma = getPrisma();
  // Resolve through the shared cached resolver so a mixed-case slug canonicalizes (same identity the
  // auth gate uses) instead of missing the lower-cased org row and returning empty fleet data.
  const org = await getOrgBySlug(orgSlug);
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
  // Week index → ISO date of that week's start (via weekStartMs, the Sunday-anchored inverse of
  // weekIndex), so the chart can label the real span instead of a literal "this week" (the grid's
  // right edge is the latest SCAN week, possibly stale).
  const weekStartIso = (wk: number) => new Date(weekStartMs(wk)).toISOString().slice(0, 10);
  return {
    weeks: series.length,
    series,
    total: series.reduce((a, b) => a + b, 0),
    repos: repoCount,
    endWeekStartMs: weekStartMs(maxWk),
    latestWeekIso: weekStartIso(maxWk),
    oldestWeekIso: weekStartIso(minWk),
  };
}
