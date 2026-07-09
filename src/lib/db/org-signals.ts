// Fleet-level signals from each repo's latest scan: pull-request stats (prStats), default-branch
// governance, and commit-activity trend (Deepen-F3). All guarded by DATABASE_URL.

import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { getOrgBySlug, segmentScope, techGroupScope } from "@/lib/db/org-shared";
import { parseStringArray } from "@/lib/db/scans-shared";
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
  avgMergeRate: number; // analyzed-PR-weighted fleet merge rate (a large repo outweighs a toy one)
  avgReviewedRate: number | null; // analyzed-weighted repo reviewedRate (null when NO repo has a human-merged sample)
  avgSmallPrRate: number; // analyzed-weighted
  avgAiInvolvedRate: number; // analyzed-weighted
  avgAiGovernedRate: number | null; // analyzed-weighted repo aiGovernedRate (null when NO repo has a sample)
  typicalHoursToMerge: number | null; // mean of per-repo medians (a median-of-medians, left unweighted)
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

  // Volume-weighted fleet rates: weight each repo's rate by its analyzed PR count, so a 500-PR flagship
  // outweighs a 1-PR toy repo instead of every repo voting equally (an average-of-averages). The old
  // unweighted mean let low-traffic repos dominate a headline "fleet" rate no meaningful slice of PRs
  // experienced — and was internally inconsistent with the commit-weighted org AI share
  // (org-contributors.ts) and the PR-count-based `totalPrs` right beside it. A nullable rate
  // (reviewedRate / aiGovernedRate — "no sample") contributes only where present and stays null when NO
  // repo carries it, preserving the null-vs-measured-0 distinction. `analyzed` is the natural fleet
  // weight (exact for the analyzed-denominated rates; a volume proxy for reviewed/governed whose exact
  // sub-denominators aren't persisted per repo). (fleet-rollups-insights #3)
  const weightedRate = (pick: (s: PrStats) => number | null): number | null => {
    let wsum = 0;
    let sum = 0;
    for (const s of stats) {
      const v = pick(s);
      if (v == null) continue; // "no sample" — not a measured 0
      wsum += s.analyzed;
      sum += v * s.analyzed;
    }
    return wsum > 0 ? Math.round(sum / wsum) : null;
  };
  const ttm = stats.map((s) => s.medianHoursToMerge).filter((x): x is number => x != null);
  const toolMap = new Map<string, number>();
  for (const s of stats) for (const t of s.tools) toolMap.set(t.name, (toolMap.get(t.name) ?? 0) + t.count);

  return {
    repos: stats.length,
    totalPrs: stats.reduce((a, s) => a + s.analyzed, 0),
    // Always-present rates: `stats` is non-empty and every row has analyzed > 0, so wsum > 0 ⇒ never null.
    avgMergeRate: weightedRate((s) => s.mergeRate) ?? 0,
    avgReviewedRate: weightedRate((s) => s.reviewedRate),
    avgSmallPrRate: weightedRate((s) => s.smallPrRate) ?? 0,
    avgAiInvolvedRate: weightedRate((s) => s.aiInvolvedRate) ?? 0,
    avgAiGovernedRate: weightedRate((s) => s.aiGovernedRate),
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

/** One repo's specific findings for a single dimension, from its latest scan. */
export interface RepoDimensionGaps {
  fullName: string;
  /** The concrete issues the scan flagged for this dimension (LLM/detector `gaps`) — the "what's
   *  wrong" list the Security register surfaces per repo. Empty when the dimension has no open gaps. */
  gaps: string[];
  /** The dimension's evidence lines. For D9 these are the deterministic check-battery findings
   *  (`Name [group/risk]: score/10 — detail`), which the register parses into the control grid. */
  evidence: string[];
  /** One-line dimension summary (the headline verdict), or "" when absent. */
  summary: string;
}

/**
 * Per-repo `gaps` (+ summary) for ONE dimension across the org's latest scans — the batched form of
 * `/api/org/repo-dimension`, so a fleet view (the Security risk register) can show each repo's
 * specific findings without an N+1 of per-repo report loads. Latest scan per repo, mirroring
 * `getOrgGovernance`'s semantics (absolute latest, not window-bounded — the gaps are descriptive
 * metadata for the score already shown). Keyed by fullName. Null when the DB is off / org unknown.
 */
export async function getOrgDimensionGaps(
  orgSlug: string,
  dimId: string,
  segmentId?: string | null,
  techGroupId?: string | null,
): Promise<Map<string, RepoDimensionGaps> | null> {
  if (!isDbConfigured()) return null;
  const prisma = getPrisma();
  const org = await getOrgBySlug(orgSlug);
  if (!org) return null;

  const repos = await prisma.repository.findMany({
    where: { orgId: org.id, ...segmentScope(segmentId), ...techGroupScope(techGroupId) },
    select: {
      fullName: true,
      scans: {
        orderBy: { scannedAt: "desc" },
        take: 1,
        select: { dimensions: { where: { dimId }, select: { gaps: true, evidence: true, summary: true } } },
      },
    },
  });

  const out = new Map<string, RepoDimensionGaps>();
  for (const r of repos) {
    const dim = r.scans[0]?.dimensions[0];
    if (!dim) continue;
    out.set(r.fullName, { fullName: r.fullName, gaps: parseStringArray(dim.gaps), evidence: parseStringArray(dim.evidence), summary: dim.summary ?? "" });
  }
  return out;
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

/** Fleet activity is a RECENT-activity read: bound the zero-filled week grid to this trailing horizon,
 *  anchored at the newest scan week, so one repo last scanned long ago can't stretch the grid back to a
 *  stale spike and dilute the trend to ~90% zeros. ~6 months reads as "recent" while dropping a repo
 *  whose latest activity is a year+ old. (fleet-rollups-insights #4) */
const ACTIVITY_HORIZON_WEEKS = 26;

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
  // Pass 1: parse each repo's latest weekly series + the absolute week its scan sits in. maxWk (the
  // newest scan week across the fleet) is the grid's right edge AND the anchor for the recency horizon.
  const parsed: { lastWeek: number; arr: number[] }[] = [];
  let newestScanWk = -Infinity;
  for (const r of repos) {
    const scan = r.scans[0];
    const raw = scan?.commitActivity;
    if (!raw) continue;
    try {
      const arr = JSON.parse(raw) as unknown;
      if (!Array.isArray(arr) || !arr.length) continue;
      const lastWeek = weekIndex(scan!.scannedAt.getTime()); // the scan's own week = the series' last element
      parsed.push({ lastWeek, arr: arr as number[] });
      if (lastWeek > newestScanWk) newestScanWk = lastWeek;
    } catch {
      /* ignore */
    }
  }
  if (!parsed.length) return null;

  // Pass 2: bucket by absolute calendar week, but DROP any week older than the trailing horizon anchored
  // at the newest scan week (fleet-rollups-insights #4). Without this, ONE repo last scanned long ago
  // stretched min..maxWk across a year+ and zero-filled a ~52-element series that was ~90% zeros with a
  // lone stale spike — misrepresenting recent activity. A repo whose entire latest series predates the
  // horizon contributes nothing and isn't counted. Anchoring at maxWk (the module already anchors the
  // grid's right edge to the most recent SCAN) bounds the grid WIDTH deterministically and never blanks a
  // non-empty fleet — the way a raw `now - N` clamp would for a wholly-dormant fleet.
  const floorWk = newestScanWk - (ACTIVITY_HORIZON_WEEKS - 1);
  const byWeek = new Map<number, number>();
  let repoCount = 0;
  for (const { lastWeek, arr } of parsed) {
    let contributed = false;
    for (let i = 0; i < arr.length; i++) {
      const v = arr[i];
      if (typeof v !== "number" || !Number.isFinite(v)) continue;
      const wk = lastWeek - (arr.length - 1 - i); // element i counts back (arr.length - 1 - i) weeks
      if (wk < floorWk) continue; // older than the trailing horizon — don't let a stale repo stretch the grid
      byWeek.set(wk, (byWeek.get(wk) ?? 0) + v);
      contributed = true;
    }
    if (contributed) repoCount += 1;
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
