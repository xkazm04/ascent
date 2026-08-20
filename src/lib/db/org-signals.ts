// Fleet-level signals from each repo's latest scan: pull-request stats (prStats), default-branch
// governance, and commit-activity trend (Deepen-F3). All guarded by DATABASE_URL.

import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { getOrgBySlug, segmentScope, techGroupScope } from "@/lib/db/org-shared";
import { getOrgId } from "@/lib/db/org-rollup";
import { dayKeyInZone, daysBetweenDayKeys, resolveOrgTimeZone } from "@/lib/org/timezone";
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
  /** % of analyzed PRs whose title starts with "Revert" (W1a). Null only when the stored blob
   *  predates the field — never a fabricated 0 for an unmeasured repo. */
  revertRate: number | null;
  /** Median hours from a PR opening to its first review — the review-capacity signal (W1a).
   *  Null when no PR in the window received a review (or the blob predates the field). */
  medianHoursToFirstReview: number | null;
  /** % of merged PRs whose merge-commit / PR-commit messages carry an AI attribution trailer (W2) —
   *  the trailer-GROUNDED attribution rate. Null under the ≥5 merged floor or on a pre-W2 blob. */
  aiTrailerRate: number | null;
  /** % of merged PRs with an AI/bot review before the first human review (W2). Same null semantics. */
  aiPreReviewedRate: number | null;
}

export interface OrgPrSignals {
  repos: number; // repos that have PR data
  totalPrs: number; // PRs analyzed across the fleet
  avgMergeRate: number; // analyzed-PR-weighted fleet merge rate (a large repo outweighs a toy one)
  avgReviewedRate: number | null; // analyzed-weighted repo reviewedRate (null when NO repo has a human-merged sample)
  avgSmallPrRate: number; // analyzed-weighted
  avgAiInvolvedRate: number; // analyzed-weighted
  avgAiGovernedRate: number | null; // analyzed-weighted repo aiGovernedRate (null when NO repo has a sample)
  avgRevertRate: number | null; // analyzed-weighted; null only when NO blob carries the field (pre-W1a scans)
  avgAiTrailerRate: number | null; // analyzed-weighted; null when NO blob carries a merged-PR trailer sample (W2)
  avgAiPreReviewedRate: number | null; // analyzed-weighted; same null semantics (W2)
  typicalHoursToMerge: number | null; // mean of per-repo medians (a median-of-medians, left unweighted)
  typicalHoursToFirstReview: number | null; // mean of per-repo first-review medians (same shape as above)
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

  // Finite-or-null guard for the W1a fields: historical blobs written before revertRate /
  // medianHoursToFirstReview existed simply lack the keys, and a drifted blob could carry garbage.
  // Either way the answer is null ("no sample"), never NaN in a weighted mean. Mirrors
  // org-delivery-trend's num().
  const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

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
          revertRate: num(p.revertRate),
          medianHoursToFirstReview: num(p.medianHoursToFirstReview),
          aiTrailerRate: num(p.aiTrailerRate),
          aiPreReviewedRate: num(p.aiPreReviewedRate),
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
  const ttfr = stats.map((s) => num(s.medianHoursToFirstReview)).filter((x): x is number => x != null);
  const meanTenth = (xs: number[]): number | null => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null);
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
    // W1a: revertRate is analyzed-denominated (like mergeRate), but stays nullable because a
    // pre-field historical blob has no measurement to contribute — absence, not a measured 0.
    avgRevertRate: weightedRate((s) => num(s.revertRate)),
    // W2: merged-PR-denominated rates ride the same analyzed-weighted machinery (analyzed is the
    // persisted volume proxy — see the weighting note above); a pre-W2 blob or a below-floor sample
    // is null and contributes no weight, never a fabricated 0.
    avgAiTrailerRate: weightedRate((s) => num(s.aiTrailerRate)),
    avgAiPreReviewedRate: weightedRate((s) => num(s.aiPreReviewedRate)),
    typicalHoursToMerge: meanTenth(ttm),
    typicalHoursToFirstReview: meanTenth(ttfr),
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
  const orgId = await getOrgId(orgSlug);
  if (!orgId) return null;

  const repos = await prisma.repository.findMany({
    where: { orgId, ...segmentScope(segmentId), ...techGroupScope(techGroupId) },
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
  /** The CALENDAR DATE of the Sunday starting the NEWEST bucket (series[series.length - 1]),
   *  expressed as midnight UTC. A DATE LITERAL, not an instant (canonical policy note 5): the week
   *  boundary itself is a canonical-zone Sunday midnight, but what a chart axis needs is the date,
   *  and rendering that date is only zone-stable if the value carries no time-of-day. Each earlier
   *  element is exactly one WEEK_MS before it, so a consumer can step the axis with flat arithmetic
   *  and format in UTC. */
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

/** The Unix epoch day (1970-01-01) as a day key — the origin every week index counts from. */
const EPOCH_DAY_KEY = "1970-01-01";

/** 1970-01-01 was a THURSDAY, so the epoch's first Sunday is day 3. The epoch 7-day grid is therefore
 *  THURSDAY-anchored, and a naive `floor(ms / WEEK_MS)` bins on Thursdays: two scans on opposite sides
 *  of a Thursday boundary WITHIN the same Sunday-Saturday week land one bucket apart and their series
 *  sum out of phase. Floor to the named weekday FIRST, then index. */
const EPOCH_FIRST_SUNDAY_DAY = 3;

/**
 * Sunday-aligned whole-week index of an instant, IN THE CANONICAL ORG ZONE.
 *
 * This used to floor to Sunday with `getUTCDay()` / `Date.UTC`, which was correct only by coincidence
 * of the canonical zone defaulting to UTC (`src/lib/org/timezone.ts`). The dashboard window snaps in
 * the org's canonical zone (`src/lib/window.ts`), so the moment an org sets a non-UTC zone the trend
 * grid kept UTC weeks while the window moved: one local day landed in two different buckets and the
 * trend chart disagreed with the tile deltas above it by up to a day's activity at each end. All
 * boundary arithmetic in one product resolves through ONE zone; this is that zone.
 *
 * Indexing goes through DAY KEYS rather than ms arithmetic on purpose. A zoned week is 167 or 169
 * hours across a DST transition, so `floor(ms / WEEK_MS)` has no clean inverse once the grid is zoned
 * — but whole calendar days between two day keys is exact integer arithmetic with no DST in it.
 */
function weekIndexInZone(d: Date, tz: string): number {
  const dayNo = daysBetweenDayKeys(EPOCH_DAY_KEY, dayKeyInZone(d, tz));
  return Math.floor((dayNo - EPOCH_FIRST_SUNDAY_DAY) / 7);
}

/**
 * The provider's own bucket boundary: the Sunday 00:00 **UTC** that starts the GitHub commit_activity
 * week containing `ms`. GitHub's series is genuinely Sunday-UTC-aligned, and re-binning an aggregate
 * we did not collect is not possible — so the SOURCE frame stays the source's, and only the placement
 * of those buckets on the canonical grid is converted (`seriesWeekIndex`). Converting the grid without
 * converting through the source bucket would reintroduce exactly the phase bug this pair exists to fix.
 */
function providerWeekStartMs(ms: number): number {
  const d = new Date(ms);
  const utcMidnight = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return utcMidnight - d.getUTCDay() * DAY_MS; // getUTCDay(): 0 = Sunday
}

/**
 * Where the LAST element of a repo's weekly series sits on the canonical grid: the zoned week that the
 * provider bucket containing `scannedAtMs` MOSTLY covers.
 *
 * "Mostly" is the whole design, and it is implemented as the bucket's MIDPOINT (Wednesday 12:00 UTC).
 * A provider bucket runs Sun 00:00 UTC → Sat 24:00 UTC; a zoned week runs Sun 00:00 → Sat 24:00 local,
 * so the two are offset by at most the zone offset (−12h…+14h) and overlap on six of seven days. The
 * naive conversion — index the bucket's START instant in the zone — attributes a whole week of activity
 * to the zoned week it overlaps by a few hours whenever the zone is west of Greenwich: an off-by-one
 * week on every bar of the chart. The midpoint is more than 14 hours clear of both boundaries, so it
 * always names the majority week, in every IANA zone, in either DST state.
 *
 * The consequence, worth stating because it is what makes the grid trustworthy: for a provider-frame
 * series the result is the zoned week beginning on the bucket's own Sunday DATE, in any zone. The
 * arithmetic is zoned, and it PROVES the stability the old UTC code merely assumed — which is the
 * point, since the old code was only right while the canonical zone happened to be UTC. A first-party
 * series (instants we collect ourselves) would feed `weekIndexInZone` directly and genuinely move.
 */
function seriesWeekIndex(scannedAtMs: number, tz: string): number {
  return weekIndexInZone(new Date(providerWeekStartMs(scannedAtMs) + WEEK_MS / 2), tz);
}

/** Inverse of the week index, as a DATE LITERAL at midnight UTC (see `endWeekStartMs`): week `wk`
 *  starts on epoch day `wk * 7 + 3`. Consecutive Sundays are exactly 7 days apart on the date axis,
 *  which is what keeps the axis steppable by a flat WEEK_MS even when the zoned weeks themselves are
 *  167 or 169 hours long. */
const SUNDAY_EPOCH_OFFSET_MS = EPOCH_FIRST_SUNDAY_DAY * DAY_MS;
function weekStartMs(wk: number): number {
  return wk * WEEK_MS + SUNDAY_EPOCH_OFFSET_MS;
}

/** Fleet commit-activity trend — sum of each repo's latest weekly series, aligned by absolute
 *  calendar week. */
export async function getOrgActivity(orgSlug: string, segmentId?: string | null, techGroupId?: string | null): Promise<OrgActivity | null> {
  if (!isDbConfigured()) return null;
  const prisma = getPrisma();
  // Needs the full org row: the week grid is bucketed in the org's canonical zone (its stored column,
  // else ASCENT_ORG_TZ, else UTC - resolveOrgTimeZone owns that order), the SAME zone the dashboard
  // window snaps in. Routed through the cached full-row resolver rather than getOrgId (id only).
  const org = await getOrgBySlug(orgSlug);
  if (!org) return null;
  const tz = resolveOrgTimeZone(org.timezone);

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
      const lastWeek = seriesWeekIndex(scan!.scannedAt.getTime(), tz); // the scan's provider bucket = the series' last element
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
  // weekIndexInZone), so the chart can label the real span instead of a literal "this week" (the
  // grid's right edge is the latest SCAN week, possibly stale).
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
