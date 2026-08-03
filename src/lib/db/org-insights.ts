// Org insight aggregates over the fleet's latest scans: movers (F1), org-level recommendations (F2),
// the assignable backlog, calibration discrepancies, the practice library (P2), cross-repo gap
// analysis, and the corpus benchmark (F6). All guarded by DATABASE_URL.

import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { DIMENSION_BY_ID, SCORING_RUBRIC_VERSION, weightsFor } from "@/lib/maturity/model";
import { PRACTICES } from "@/lib/practices";
import { projectedGain } from "@/lib/scoring/engine";
import type { DimensionId } from "@/lib/types";
import { getOrgBySlug, IMPACT_WEIGHT, LEVEL_RANK, isBot, mean, roundedMean, segmentScope, techGroupScope, upperBound } from "@/lib/db/org-shared";
import { retentionCutoff } from "@/lib/plans";
// The canonical noise band — the same primitive alerts/digest/format already share, so a movers tile
// and a digest line can never disagree about whether a delta was real.
import { classifyDelta } from "@/lib/maturity/noise";
import type { OrgWindow } from "@/lib/db/org-rollup";
// The single canonical parser for stored `string[]` columns (the explore questions live in one) — reuse
// it here rather than forking a second parser, exactly as scans-read/scans-recommendations do.
import { parseStringArray } from "@/lib/db/scans-shared";
// The one "due soon" window (rolling days) shared with the UI tiles/labels — single-sourced in the
// client-safe backlogShared module so both layers stay in sync (backlog-management 07-16 #4).
import { DUE_MONTH_DAYS, DUE_SOON_DAYS } from "@/components/org/shared/backlogShared";
// The canonical org time-zone policy — ONE reference frame for every calendar-day decision on the
// dashboard (window presets, custom-range parsing, due-date bucketing). See its header for the policy
// and for the per-org-timezone blocker. (G4-07)
import { dayKeyInZone, dayKeyOfDateColumn, daysBetweenDayKeys, orgTimeZone, resolveOrgTimeZone } from "@/lib/org/timezone";

// ── F1: history / movers ──────────────────────────────────────────────────────

export interface RepoMove {
  fullName: string;
  name: string;
  overall: number;
  dOverall: number;
  dAdoption: number;
  dRigor: number;
  levelFrom: string;
  levelTo: string;
  levelDelta: number; // +1 promoted, -1 demoted
  postureFrom: string;
  postureTo: string;
  sinceDays: number;
  /** "period" = baseline is a genuine scan strictly before the window start — this move is a real
   *  period delta. "onboarded" = the repo had NO scan before the window start, so the baseline fell
   *  back to its earliest in-window scan: this move is the repo's LIFETIME delta since first scan, not
   *  a period delta — it must never be counted toward gainers/regressers/comparedRepos (G4-06), or it
   *  overstates fleet momentum for exactly the periods where an org is onboarding new repos. */
  baselineKind: "period" | "onboarded";
}

export interface OrgMovers {
  gainers: RepoMove[];
  regressers: RepoMove[];
  /** Repos whose overall moved, but by no more than SCORE_NOISE_BAND — a delta indistinguishable from
   *  scan-to-scan wobble. Kept as a separate bucket rather than dropped so "nothing really moved" stays
   *  visible and countable; never merge these into gainers/regressers. */
  held: RepoMove[];
  levelChanges: RepoMove[]; // promotions + demotions
  /** Repos onboarded mid-period (`baselineKind: "onboarded"`) — their first-scan→now move, kept OUT of
   *  gainers/regressers/held/levelChanges/comparedRepos so a fleet's onboarding wave can't read as this
   *  period's improvement. Sorted like gainers (largest climb first) so "new this period" is still
   *  visible to any caller that wants it, without corrupting the period comparison (G4-06). */
  onboarded: RepoMove[];
  /** Count of repos with a REAL period-baseline comparison (baselineKind === "period"). Excludes
   *  onboarded repos — see `onboarded` above. */
  comparedRepos: number;
}

interface ScanLite {
  overallScore: number;
  adoptionScore: number;
  rigorScore: number;
  level: string;
  posture: string;
  scannedAt: Date;
}

/** Construct a RepoMove from a baseline (`prev`) and current (`now`) scan of one repo. `baselineKind`
 *  defaults to "period" (a genuine prior scan) — the windowed path passes "onboarded" explicitly when
 *  `prev` is a fallback to the repo's earliest in-window scan rather than a true pre-window baseline. */
function buildMove(fullName: string, name: string, now: ScanLite, prev: ScanLite, baselineKind: RepoMove["baselineKind"] = "period"): RepoMove {
  return {
    fullName,
    name,
    overall: now.overallScore,
    dOverall: now.overallScore - prev.overallScore,
    dAdoption: now.adoptionScore - prev.adoptionScore,
    dRigor: now.rigorScore - prev.rigorScore,
    levelFrom: prev.level,
    levelTo: now.level,
    levelDelta: (LEVEL_RANK[now.level] ?? 0) - (LEVEL_RANK[prev.level] ?? 0),
    postureFrom: prev.posture,
    postureTo: now.posture,
    sinceDays: Math.max(0, Math.round((now.scannedAt.getTime() - prev.scannedAt.getTime()) / 86_400_000)),
    baselineKind,
  };
}

/**
 * Per-repo change over a window — the "what moved" view. With a `window.start`, each repo's
 * latest scan inside `[start, endExclusive)` is compared to its baseline (latest scan strictly < start, matching
 * getOrgRollup's half-open cohort), so movers reflect the selected period. Without a window, it
 * falls back to the two most recent scans ("since last scan").
 */
export async function getOrgMovers(orgSlug: string, window?: OrgWindow, segmentId?: string | null, techGroupId?: string | null): Promise<OrgMovers | null> {
  if (!isDbConfigured()) return null;
  const prisma = getPrisma();
  const org = await getOrgBySlug(orgSlug);
  if (!org) return null;

  // Plan retention floor (fleet-rollups-insights #1): the movers' baseline is entitlement-gated
  // exactly like getOrgRollup's trend + baseline — clamp the window start to the tier's retention
  // cutoff so a Free org's 90d/quarter movers aren't computed against history the plan doesn't buy.
  const retentionStart = retentionCutoff(org.plan, Date.now());
  const rawStart = window?.start ?? null;
  const start = rawStart && retentionStart && retentionStart > rawStart ? retentionStart : rawStart;
  // Half-open upper bound (`lt: endExclusive`, falling back to the legacy `lte: end`).
  const upper = upperBound(window);
  const seg = { ...segmentScope(segmentId), ...techGroupScope(techGroupId) };
  const moves: RepoMove[] = [];

  if (start) {
    // Windowed. The function only needs, per repo, the latest scan inside the window ("now") and the latest scan
    // strictly < start (the half-open baseline) — so bound BOTH queries to the period instead of pulling
    // the org's entire scan history into memory (which scaled with fleet age, not the period: an org
    // scanned daily across hundreds of repos for a year+ dragged tens of thousands of rows into Node on
    // every executive/briefing/live render). The in-window query is bounded on both sides; the baseline
    // query takes only the latest pre-start scan PER REPO (distinct) so it stays one row per repo.
    const repoScope = { orgId: org.id, ...seg };
    const inWindow = await prisma.scan.findMany({
      where: { repo: repoScope, scannedAt: { gte: start, ...(upper ?? {}) } },
      select: {
        repoId: true,
        overallScore: true,
        adoptionScore: true,
        rigorScore: true,
        level: true,
        posture: true,
        scannedAt: true,
        repo: { select: { fullName: true, name: true } },
      },
      orderBy: { scannedAt: "desc" },
    });
    // Latest scan STRICTLY before `start`, one per repo (matches getOrgRollup's half-open `lt: start`
    // cohort). `distinct` bounds this to a single row per repo at the DB; we still pick the first (latest,
    // desc) per repo in code so the baseline is correct regardless of the driver's distinct support.
    const preStart = await prisma.scan.findMany({
      where: { repo: repoScope, scannedAt: { lt: start } },
      select: {
        repoId: true,
        overallScore: true,
        adoptionScore: true,
        rigorScore: true,
        level: true,
        posture: true,
        scannedAt: true,
        repo: { select: { fullName: true, name: true } },
      },
      orderBy: { scannedAt: "desc" },
      distinct: ["repoId"],
    });
    const byRepo = new Map<string, typeof inWindow>();
    for (const r of inWindow) {
      const arr = byRepo.get(r.repoId) ?? [];
      arr.push(r);
      byRepo.set(r.repoId, arr);
    }
    const baselineByRepo = new Map<string, (typeof inWindow)[number]>();
    for (const r of preStart) if (!baselineByRepo.has(r.repoId)) baselineByRepo.set(r.repoId, r); // first = latest (desc)

    for (const [repoId, arr] of byRepo) {
      const now = arr[0]; // latest in-window (rows are scannedAt desc)
      // Baseline = latest scan STRICTLY before the window start, so a scan exactly at `start` is
      // classified IDENTICALLY by both surfaces (it belongs to the current window, not the baseline) —
      // the movers panel and the headline period-delta tiles agree on the boundary. A repo ONBOARDED
      // mid-period has no scan before `start`, so fall back to its EARLIEST in-window scan (arr is desc,
      // so the last element) rather than dropping it from movers entirely — it genuinely moved (first
      // score → now) within the window. That fallback move is tagged `baselineKind: "onboarded"` below
      // and kept OUT of gainers/regressers/comparedRepos (G4-06): it's a LIFETIME delta since the
      // repo's first scan, not a period delta, and reporting it as a period gain would inflate the
      // mover list and comparedRepos exactly when an org is growing. A repo with a single in-window
      // scan and no baseline collapses to prev === now and is skipped below.
      const realBaseline = baselineByRepo.get(repoId);
      const prev = realBaseline ?? arr[arr.length - 1];
      if (!now || !prev || prev === now) continue; // no baseline, or nothing moved within the window
      moves.push(buildMove(now.repo.fullName, now.repo.name, now, prev, realBaseline ? "period" : "onboarded"));
    }
  } else {
    const repos = await prisma.repository.findMany({
      where: { orgId: org.id, ...seg },
      select: {
        fullName: true,
        name: true,
        scans: {
          orderBy: { scannedAt: "desc" },
          take: 2,
          select: { overallScore: true, adoptionScore: true, rigorScore: true, level: true, posture: true, scannedAt: true },
        },
      },
    });
    for (const r of repos) {
      if (r.scans.length < 2) continue;
      const [now, prev] = r.scans as [ScanLite, ScanLite]; // safe: length >= 2 checked above
      moves.push(buildMove(r.fullName, r.name, now, prev));
    }
  }

  // Stable `fullName` tiebreak on each single-key sort (fleet-rollups-insights #6): repos with an equal
  // delta / level-change otherwise render in the query's arbitrary order, so the same fleet reshuffles
  // between renders.
  // Split OUT onboarded repos (G4-06) before any bucketing: their move is a lifetime (first-scan→now)
  // delta, not a period delta, so it must never feed gainers/regressers/held/levelChanges/comparedRepos —
  // that would let a fleet's onboarding wave read as this period's improvement, and it would inflate
  // comparedRepos with repos that were never actually cohort-compared against a period baseline.
  const periodMoves = moves.filter((m) => m.baselineKind === "period");
  const onboardedMoves = moves.filter((m) => m.baselineKind === "onboarded");
  // Partition on the NOISE BAND, not on strict sign. A +1 is arithmetically a gain but statistically
  // indistinguishable from two independent re-scans of an unchanged commit, and this function is the
  // raw feed the Executive Briefing, /portfolio and the digest all read — so a strict-sign split let a
  // wobble be reported as a "top gainer" in a document a customer files. Sub-band moves go to `held`.
  return {
    gainers: periodMoves.filter((m) => classifyDelta(m.dOverall) === "up").sort((a, b) => b.dOverall - a.dOverall || a.fullName.localeCompare(b.fullName)),
    regressers: periodMoves.filter((m) => classifyDelta(m.dOverall) === "down").sort((a, b) => a.dOverall - b.dOverall || a.fullName.localeCompare(b.fullName)),
    held: periodMoves.filter((m) => m.dOverall !== 0 && classifyDelta(m.dOverall) === "noise").sort((a, b) => a.fullName.localeCompare(b.fullName)),
    levelChanges: periodMoves.filter((m) => m.levelDelta !== 0).sort((a, b) => b.levelDelta - a.levelDelta || a.fullName.localeCompare(b.fullName)),
    onboarded: onboardedMoves.sort((a, b) => b.dOverall - a.dOverall || a.fullName.localeCompare(b.fullName)),
    comparedRepos: periodMoves.length,
  };
}

// ── F2: org-level recommendations ─────────────────────────────────────────────

export interface OrgRec {
  title: string;
  dimId: string;
  impact: string;
  /** Why this gap matters for AI-driven development — the companion-voice rationale carried from the
   *  recommendation rows, so the org surface can EXPLAIN a gap the way the repo report does, not command
   *  it. Empty string for legacy scans that predate stored rationale. */
  rationale: string;
  /** Invitational questions to explore the gap — the same `explore[]` the repo report surfaces (parsed
   *  from the stored JSON via the shared parseStringArray). Empty for legacy scans. */
  explore: string[];
  repoCount: number;
  repos: string[];
  leverage: number;
  /** Engine-true ROI: the AVERAGE overall-score points an affected repo gains if this dimension's gap
   *  is fully closed (mean of projectedGain over each affected repo's stored dims + archetype). Null when
   *  no affected repo has persisted dimension rows (pre-dimension scans). Turns "explore" into a decision. */
  projectedPoints: number | null;
  /** How many of the affected repos this move would advance to the next maturity level. */
  liftsRepos: number;
}

/** Aggregate open recommendations across the fleet's latest scans → highest-leverage moves. */
export async function getOrgRecommendations(orgSlug: string, limit = 8, segmentId?: string | null, techGroupId?: string | null): Promise<OrgRec[] | null> {
  if (!isDbConfigured()) return null;
  const prisma = getPrisma();
  const org = await getOrgBySlug(orgSlug);
  if (!org) return null;

  const repos = await prisma.repository.findMany({
    where: { orgId: org.id, ...segmentScope(segmentId), ...techGroupScope(techGroupId) },
    select: {
      name: true,
      scans: {
        orderBy: { scannedAt: "desc" },
        take: 1,
        select: {
          // Dimension scores + archetype feed projectedGain — the engine-true "+N pts" per move, so the
          // overview can NAME the highest-leverage decision (and its maturity gain), not just rank gaps.
          archetype: true,
          dimensions: { select: { dimId: true, score: true } },
          recommendations: {
            where: { status: { in: ["open", "in_progress"] } },
            // rationale + explore carry the companion voice (why the gap matters + questions to explore)
            // onto the org surface — same rows already read, so no extra query.
            select: { title: true, dimId: true, impact: true, rationale: true, explore: true },
          },
        },
      },
    },
  });

  const w = weightsFor("org");
  // Per-repo dims + archetype, so a rec-group can compute the projected gain over exactly its affected repos.
  const repoDims = new Map<string, { archetype: string; dims: { id: string; score: number }[] }>();
  // rationale + explore are captured from the FIRST rec seen in a group: dedup keys on `dimId::title`,
  // and identical gaps share the same catalog-derived rationale/questions, so the first is representative.
  const groups = new Map<string, { title: string; dimId: string; impact: string; rationale: string; explore: string[]; repos: Set<string> }>();
  for (const r of repos) {
    const scan = r.scans[0];
    if (scan) repoDims.set(r.name, { archetype: scan.archetype, dims: (scan.dimensions ?? []).map((d) => ({ id: d.dimId, score: d.score })) });
    const recs = scan?.recommendations ?? [];
    for (const rec of recs) {
      const key = `${rec.dimId}::${rec.title}`;
      const g = groups.get(key) ?? { title: rec.title, dimId: rec.dimId, impact: rec.impact, rationale: rec.rationale, explore: parseStringArray(rec.explore), repos: new Set<string>() };
      g.repos.add(r.name);
      // keep the strongest impact seen for this rec
      if ((IMPACT_WEIGHT[rec.impact] ?? 0) > (IMPACT_WEIGHT[g.impact] ?? 0)) g.impact = rec.impact;
      groups.set(key, g);
    }
  }

  const recs: OrgRec[] = [...groups.values()].map((g) => {
    const repoCount = g.repos.size;
    const dimW = w[g.dimId as DimensionId] ?? 0.1;
    // Engine-true projected gain over THIS move's affected repos: mean overall-points each would gain if
    // the dimension is closed, and how many would advance a level. Repos with no persisted dims are skipped.
    let sumPoints = 0;
    let withDims = 0;
    let liftsRepos = 0;
    for (const name of g.repos) {
      const rd = repoDims.get(name);
      if (!rd || rd.dims.length === 0) continue;
      const gain = projectedGain(rd.dims, rd.archetype, g.dimId);
      sumPoints += gain.points;
      if (gain.unlocks) liftsRepos += 1;
      withDims += 1;
    }
    return {
      title: g.title,
      dimId: g.dimId,
      impact: g.impact,
      rationale: g.rationale,
      explore: g.explore,
      repoCount,
      repos: [...g.repos].sort(),
      leverage: Math.round(repoCount * (IMPACT_WEIGHT[g.impact] ?? 1) * (1 + dimW) * 10) / 10,
      projectedPoints: withDims > 0 ? Math.round((sumPoints / withDims) * 10) / 10 : null,
      liftsRepos,
    };
  });
  recs.sort((a, b) => b.leverage - a.leverage || b.repoCount - a.repoCount);
  return recs.slice(0, limit);
}

// ── Recommendation backlog — owners, due dates, and a trackable roadmap ─────────
// Where getOrgRecommendations DEDUPES identical gaps across repos into systemic moves, the backlog
// lists the concrete per-repo recommendation rows that carry an OWNER and a DUE DATE — the unit a
// leader actually assigns and tracks. It reads the latest scan per repo (status, assignee, and due
// date carry forward across re-scans) and groups the actionable items (open + in_progress) two ways:
// by owner (who is accountable) and by due-date bucket (what is overdue / due soon). Done and
// dismissed items are summarized in the counts but kept out of the active lists.

export type BacklogDueBucket = "overdue" | "this_week" | "this_month" | "later" | "no_date";

// Labels state the ROLLING cutoffs honestly and NUMERICALLY: "this_week"/"this_month" are ≤7 / ≤31
// rolling days, not calendar-aligned periods — "Due this month" read as calendar-month and mis-bucketed
// a July-29 vs Aug-1 pair on July 1. Both labels are now interpolated from the constants that do the
// bucketing (DUE_SOON_DAYS / DUE_MONTH_DAYS), so the words and the maths cannot disagree: the vaguer
// "within a month" is gone, because "a month" is 28-31 days and the cutoff is exactly 31.
// (G4-07; extends ambiguity-ui 2026-07-16 #4)
const DUE_BUCKET_LABEL: Record<BacklogDueBucket, string> = {
  overdue: "Overdue",
  this_week: `Due within ${DUE_SOON_DAYS} days`,
  this_month: `Due within ${DUE_MONTH_DAYS} days`,
  later: "Later",
  no_date: "No due date",
};

/** Fixed display order for the due-date columns (most urgent first; undated last). */
const DUE_BUCKET_ORDER: BacklogDueBucket[] = ["overdue", "this_week", "this_month", "later", "no_date"];

/** Whole calendar days from `now` to `target`, negative when `target` is past.
 *
 *  Both sides now resolve in the SINGLE CANONICAL ORG ZONE (`src/lib/org/timezone.ts` — UTC by
 *  default). Previously this compared a UTC-truncated `target` against a SERVER-LOCAL-truncated
 *  `now` — two different calendar frames differenced directly, which flipped overdue/this_week for
 *  the hours between the two midnights on any non-UTC host, on the one bucket (Overdue) that drives
 *  the owner sort. Half of that was deliberate and is preserved: `target` is a DATE-ONLY column
 *  written as midnight UTC, so it is read back with `dayKeyOfDateColumn` (UTC getters) to recover the
 *  literal day the user picked — re-truncating it in a westward zone would yield the previous day.
 *  What changed is the OTHER side: `now` is truncated in the canonical zone, not the host's.
 *  (G4-07; supersedes ambiguity-ui 2026-07-16 #4, which unified on the host's local day) */
function daysUntil(target: Date, now: Date, tz?: string): number {
  return daysBetweenDayKeys(dayKeyInZone(now, tz ?? orgTimeZone()), dayKeyOfDateColumn(target));
}

/**
 * Which due-date bucket a target date falls into, relative to `now`. Pure (no clock read) so the
 * bucketing is unit-testable: null → no_date; past → overdue; ≤ DUE_SOON_DAYS → this_week;
 * ≤ DUE_MONTH_DAYS → this_month; beyond → later. Boundaries are HALF-OPEN in the same sense as the
 * window's: a day belongs to exactly one bucket, and "due today" (d === 0) is this_week, never overdue.
 */
export function dueBucketFor(targetDate: Date | null, now: Date, tz?: string): BacklogDueBucket {
  if (!targetDate) return "no_date";
  const d = daysUntil(targetDate, now, tz);
  if (d < 0) return "overdue";
  if (d <= DUE_SOON_DAYS) return "this_week";
  if (d <= DUE_MONTH_DAYS) return "this_month";
  return "later";
}

/** One assignable recommendation in the backlog — a concrete per-repo row with owner + due date. */
export interface BacklogItem {
  id: string;
  title: string;
  dimId: string;
  dimLabel: string;
  impact: string;
  effort: string;
  status: string;
  assigneeLogin: string | null;
  targetDate: string | null; // ISO date (YYYY-MM-DD), or null
  dueBucket: BacklogDueBucket;
  /** Whole days until due (negative = overdue); null when undated. */
  dueInDays: number | null;
  overdue: boolean;
  repo: string; // owner/name
  repoName: string;
  /** Most recent activity (latest event) or the row's creation time, ISO. */
  lastActivityAt: string;
  /** Engine-true ROI: overall-score points the repo gains if this dimension's gap is fully
   * closed (projectedGain over the scan's stored dims + archetype). Null when the scan
   * predates persisted dimensions. Display-only — never feeds back into scoring. */
  projectedPoints: number | null;
  /** The maturity level closing this gap crosses into (e.g. "L3"), or null when it stays in band. */
  unlocks: string | null;
  /** Why this gap matters for AI-driven development — the companion-voice rationale carried from the
   *  recommendation row (surfaced in the row's expandable area). Empty string for legacy scans. */
  rationale: string;
  /** Invitational questions to explore the gap — the same `explore[]` the repo report surfaces (parsed
   *  from stored JSON via the shared parseStringArray). Empty for legacy scans. */
  explore: string[];
}

/** Status tallies shared by the overall summary and each owner group. */
interface BacklogCounts {
  open: number;
  inProgress: number;
  done: number;
  dismissed: number;
  overdue: number;
}

export interface BacklogOwnerGroup extends BacklogCounts {
  login: string | null; // null = the Unassigned bucket
  /** Count of active (open + in_progress) items — the size of this owner's working backlog. */
  active: number;
  items: BacklogItem[];
}

export interface BacklogDueGroup {
  bucket: BacklogDueBucket;
  label: string;
  items: BacklogItem[];
}

export interface OrgBacklog extends BacklogCounts {
  org: string;
  /** True when the grouped lists also carry done/dismissed rows (the "show closed" recovery view).
   *  The headline counts are IDENTICAL either way — they always describe the active working backlog —
   *  so the summary strip can't swing when the toggle flips. */
  includesClosed: boolean;
  /** Scanned repos contributing recommendations. */
  repos: number;
  /** Total recommendations across the fleet's latest scans (all statuses). */
  tracked: number;
  /** Active items shown in the grouped lists (open + in_progress). */
  active: number;
  assigned: number; // active items with an owner
  unassigned: number; // active items without one
  dueSoon: number; // active items due within DUE_SOON_DAYS days (not already overdue)
  byOwner: BacklogOwnerGroup[]; // most overdue, then largest working backlog; Unassigned last
  byDue: BacklogDueGroup[]; // fixed bucket order
  /** Distinct human contributor logins across the fleet — options for the assignee picker. */
  assignees: string[];
}

/**
 * The org-wide recommendation backlog: every actionable gap from the fleet's latest scans, with its
 * owner and due date, grouped by owner and by due-date bucket. This is the planning surface the
 * status/assignee/due-date layer feeds — see updateRecommendation + getRecommendationEvents for the
 * per-item history. Segment-aware (scopes to a tagged slice when `segmentId` is given). Returns null
 * when persistence is off or the org doesn't exist.
 *
 * `opts.includeClosed` is the RECOVERY view (G6-02). By default the grouped lists carry only
 * open/in_progress items, which is what made a mis-picked "Dismissed" effectively irreversible: the row
 * left every view on the next read and nothing could bring it back. With the flag set, done/dismissed
 * rows are grouped too, so their status control is reachable again and the item can be set back to Open.
 * The headline counts never change with the flag — they always describe the ACTIVE backlog.
 *
 * ── Why this reads in six flat queries instead of one nested `include` (measured 2026-08-03) ──
 * The obvious shape — repository → scans(take 1) → recommendations → events(take 1) — is NOT an N+1.
 * Prisma 6.19 with `engineType = "client"` (the wasm query compiler, see the generator block in
 * prisma/schema.prisma) already flattens every relation level into ONE `... WHERE x IN (…)` statement,
 * so the nested form issues exactly 5 SQL round trips whether the fleet is 5 repos or 500. Anyone
 * "fixing the N+1" by hand-splitting the query gets the same 5 statements and slightly worse latency.
 *
 * The real cost is ROW VOLUME, and it is invisible from the query count: the compiler applies a nested
 * `take` AFTER the fetch, so `scans: { take: 1 }` emits a `SELECT … FROM "Scan" WHERE "repoId" IN (…)`
 * with **no LIMIT** — the org's ENTIRE scan history crosses the wire so the compiler can keep one row
 * per repo. Same for `events: { take: 1 }`: every event ever written on every current recommendation is
 * transferred to keep the newest. That scales with fleet AGE and tracker ACTIVITY, not with what the
 * page renders. (`distinct` is no help — it is also applied client-side under this engine; the SQL
 * carries no DISTINCT ON. The "bounds this AT THE DB" claims elsewhere in this layer predate that.)
 *
 * So the "latest per group" picks are pushed into SQL as `groupBy … _max`, which IS a real GROUP BY.
 * Measured against PGlite, 300 repos × 10 recs, 60 scans/repo, 8 events/rec:
 *   nested include → 5 statements, 48,000 rows, 1,286–3,262ms
 *   this shape     → 6 statements,  9,600 rows,   656–937ms   (5× fewer rows, 2–3.5× faster)
 * The trade is one extra round trip, which costs ~25ms on a fleet with NO history (1 scan/repo, 1
 * event/rec) — a brand-new org, before the first rescan. Depth ≥ 2 is the steady state, so the deep
 * case governs. org-insights-backlog-queries.test.ts pins the plan against silent regression: the
 * query count must stay CONSTANT in fleet size, and no read may reintroduce an unbounded nested `take`.
 */
export async function getOrgBacklog(
  orgSlug: string,
  segmentId?: string | null,
  now: Date = new Date(),
  techGroupId?: string | null,
  opts?: { includeClosed?: boolean },
): Promise<OrgBacklog | null> {
  const includeClosed = opts?.includeClosed === true;
  if (!isDbConfigured()) return null;
  const prisma = getPrisma();
  const org = await getOrgBySlug(orgSlug);
  if (!org) return null;
  // "Overdue" must mean overdue in THIS org's calendar, not the deployment's: the org's stored zone when
  // it has one, else ASCENT_ORG_TZ, else UTC (resolveOrgTimeZone owns that order). G4-07.
  const tz = resolveOrgTimeZone(org.timezone);

  const repoScope = { orgId: org.id, ...segmentScope(segmentId), ...techGroupScope(techGroupId) };

  // Wave 1 — three independent reads, so they cost one round trip's latency, not three. The groupBy
  // scopes through the `repo` relation rather than an id list precisely so it does NOT have to wait for
  // the repository read.
  const [repos, latestScanAt, contributorRows] = await Promise.all([
    prisma.repository.findMany({ where: repoScope, select: { id: true, fullName: true, name: true } }),
    // The "latest scan per repo" pick, as a real SQL GROUP BY (see the header: a nested `take: 1` would
    // instead drag the org's whole scan history across the wire).
    prisma.scan.groupBy({ by: ["repoId"], where: { repo: repoScope }, _max: { scannedAt: true } }),
    // Distinct human logins across the fleet's contributor snapshots — the assignee picker options.
    prisma.repoContributor.findMany({ where: { repo: repoScope }, select: { login: true }, distinct: ["login"] }),
  ]);

  // Wave 2 — resolve those (repoId, scannedAt) pairs to the scan rows themselves. Two scans of one repo
  // could share a timestamp (a seeded fixture, a same-instant backfill), so the pick is deduped in code:
  // one scan per repo, exactly what the nested `take: 1` guaranteed.
  const latestPairs = latestScanAt
    .filter((s): s is typeof s & { _max: { scannedAt: Date } } => s._max.scannedAt != null)
    .map((s) => ({ repoId: s.repoId, scannedAt: s._max.scannedAt }));
  const scanRows = latestPairs.length
    ? await prisma.scan.findMany({
        where: { OR: latestPairs },
        // archetype feeds projectedGain — the engine-true "+N pts · unlocks LX" per item, so the backlog
        // can be prioritized on points, not just impact words.
        select: { id: true, repoId: true, archetype: true },
      })
    : [];
  const scanByRepo = new Map<string, (typeof scanRows)[number]>();
  for (const s of scanRows) if (!scanByRepo.has(s.repoId)) scanByRepo.set(s.repoId, s);
  const scanIds = [...scanByRepo.values()].map((s) => s.id);

  // Wave 3 — the two reads hanging off the chosen scans, again in parallel.
  const [dimRows, recRows] = scanIds.length
    ? await Promise.all([
        prisma.scanDimension.findMany({
          where: { scanId: { in: scanIds } },
          select: { scanId: true, dimId: true, score: true },
        }),
        prisma.recommendation.findMany({
          where: { scanId: { in: scanIds } },
          orderBy: { createdAt: "asc" },
          select: {
            id: true,
            scanId: true,
            title: true,
            dimId: true,
            impact: true,
            effort: true,
            // rationale + explore carry the companion voice onto the backlog row (same rows already read).
            rationale: true,
            explore: true,
            status: true,
            assigneeLogin: true,
            targetDate: true,
            createdAt: true,
          },
        }),
      ])
    : [[], []];

  // Wave 4 — last-activity per recommendation. `_max(createdAt)` is the whole reason this isn't the
  // `events: { take: 1 }` relation: it returns one row per rec instead of every event ever written.
  const lastEventRows = recRows.length
    ? await prisma.recommendationEvent.groupBy({
        by: ["recommendationId"],
        where: { recommendationId: { in: recRows.map((r) => r.id) } },
        _max: { createdAt: true },
      })
    : [];
  const lastEventAt = new Map<string, Date>();
  for (const e of lastEventRows) if (e._max.createdAt) lastEventAt.set(e.recommendationId, e._max.createdAt);

  const dimsByScan = new Map<string, { id: string; score: number }[]>();
  for (const d of dimRows) {
    const arr = dimsByScan.get(d.scanId) ?? [];
    arr.push({ id: d.dimId, score: d.score });
    dimsByScan.set(d.scanId, arr);
  }
  const recsByScan = new Map<string, typeof recRows>();
  for (const r of recRows) {
    const arr = recsByScan.get(r.scanId) ?? [];
    arr.push(r);
    recsByScan.set(r.scanId, arr);
  }

  const assignees = contributorRows
    .map((c) => c.login)
    .filter((l) => !isBot(l))
    .sort((a, b) => a.localeCompare(b));

  const ACTIVE = new Set(["open", "in_progress"]);
  const items: BacklogItem[] = [];
  const counts: BacklogCounts = { open: 0, inProgress: 0, done: 0, dismissed: 0, overdue: 0 };
  let tracked = 0;
  let contributingRepos = 0;

  for (const repo of repos) {
    const scan = scanByRepo.get(repo.id);
    const recs = scan ? (recsByScan.get(scan.id) ?? []) : [];
    if (recs.length > 0) contributingRepos += 1;
    // Engine-true ROI per dimension, computed once per repo (each scan has ≤ ~6 roadmap rows
    // across ≤ 9 dims). Scans persisted before dimension rows existed project null, not 0.
    const dims = scan ? (dimsByScan.get(scan.id) ?? []) : [];
    const gainFor = (dimId: string) =>
      dims.length > 0 && scan ? projectedGain(dims, scan.archetype, dimId) : null;
    for (const r of recs) {
      tracked += 1;
      if (r.status === "open") counts.open += 1;
      else if (r.status === "in_progress") counts.inProgress += 1;
      else if (r.status === "done") counts.done += 1;
      else if (r.status === "dismissed") counts.dismissed += 1;

      // Only open / in_progress items make up the working backlog the views group and surface —
      // unless the caller asked for the closed-item recovery view (G6-02).
      const active = ACTIVE.has(r.status);
      if (!active && !includeClosed) continue;

      const dueInDays = r.targetDate ? daysUntil(r.targetDate, now, tz) : null;
      // "Overdue" is a property of work still to be done: a dismissed item with a past due date is not
      // a debt, so it must never inflate the overdue tile just because the recovery view is open.
      const overdue = active && dueInDays != null && dueInDays < 0;
      if (overdue) counts.overdue += 1;
      const gain = gainFor(r.dimId);
      items.push({
        id: r.id,
        title: r.title,
        dimId: r.dimId,
        dimLabel: DIMENSION_BY_ID[r.dimId as DimensionId]?.name ?? r.dimId,
        impact: r.impact,
        effort: r.effort,
        status: r.status,
        assigneeLogin: r.assigneeLogin,
        targetDate: r.targetDate ? r.targetDate.toISOString().slice(0, 10) : null,
        dueBucket: dueBucketFor(r.targetDate, now, tz),
        dueInDays,
        overdue,
        repo: repo.fullName,
        repoName: repo.name,
        lastActivityAt: (lastEventAt.get(r.id) ?? r.createdAt).toISOString(),
        projectedPoints: gain ? gain.points : null,
        unlocks: gain ? gain.unlocks : null,
        rationale: r.rationale,
        explore: parseStringArray(r.explore),
      });
    }
  }

  // Within a group, surface the most pressing work first: soonest due (undated last), then highest
  // impact, then most recently touched.
  const impactRank = (i: string) => IMPACT_WEIGHT[i] ?? 0;
  const sortItems = (a: BacklogItem, b: BacklogItem) => {
    // In the recovery view, closed rows sink below the live work — they are there to be found and
    // restored, not to compete with the working backlog for the top of a group.
    const aActive = ACTIVE.has(a.status);
    const bActive = ACTIVE.has(b.status);
    if (aActive !== bActive) return aActive ? -1 : 1;
    const ad = a.dueInDays ?? Number.POSITIVE_INFINITY;
    const bd = b.dueInDays ?? Number.POSITIVE_INFINITY;
    if (ad !== bd) return ad - bd;
    if (impactRank(b.impact) !== impactRank(a.impact)) return impactRank(b.impact) - impactRank(a.impact);
    return b.lastActivityAt.localeCompare(a.lastActivityAt);
  };
  items.sort(sortItems);

  // Group by owner (null = Unassigned).
  const ownerMap = new Map<string | null, BacklogOwnerGroup>();
  for (const it of items) {
    const key = it.assigneeLogin;
    const g =
      ownerMap.get(key) ??
      { login: key, active: 0, open: 0, inProgress: 0, done: 0, dismissed: 0, overdue: 0, items: [] as BacklogItem[] };
    g.items.push(it);
    if (ACTIVE.has(it.status)) g.active += 1;
    if (it.status === "open") g.open += 1;
    else if (it.status === "in_progress") g.inProgress += 1;
    else if (it.status === "done") g.done += 1;
    else if (it.status === "dismissed") g.dismissed += 1;
    if (it.overdue) g.overdue += 1;
    ownerMap.set(key, g);
  }
  const byOwner = [...ownerMap.values()].sort((a, b) => {
    // Unassigned always sits last so it reads as the "needs an owner" pile, not a person.
    if ((a.login === null) !== (b.login === null)) return a.login === null ? 1 : -1;
    if (a.overdue !== b.overdue) return b.overdue - a.overdue;
    if (a.active !== b.active) return b.active - a.active;
    return (a.login ?? "").localeCompare(b.login ?? "");
  });

  // Group by due-date bucket, in fixed urgency order (empty buckets omitted).
  const dueMap = new Map<BacklogDueBucket, BacklogItem[]>();
  for (const it of items) {
    const arr = dueMap.get(it.dueBucket) ?? [];
    arr.push(it);
    dueMap.set(it.dueBucket, arr);
  }
  const byDue: BacklogDueGroup[] = DUE_BUCKET_ORDER.filter((b) => dueMap.has(b)).map((bucket) => ({
    bucket,
    label: DUE_BUCKET_LABEL[bucket],
    items: dueMap.get(bucket)!,
  }));

  // The headline numbers always describe the ACTIVE working backlog, whether or not the closed rows
  // are being shown — a recovery toggle that also moved every summary tile would read as data changing.
  const activeItems = items.filter((i) => ACTIVE.has(i.status));
  const assigned = activeItems.filter((i) => i.assigneeLogin).length;
  const dueSoon = activeItems.filter((i) => i.dueInDays != null && i.dueInDays >= 0 && i.dueInDays <= DUE_SOON_DAYS).length;

  return {
    org: orgSlug,
    includesClosed: includeClosed,
    repos: contributingRepos,
    tracked,
    active: activeItems.length,
    open: counts.open,
    inProgress: counts.inProgress,
    done: counts.done,
    dismissed: counts.dismissed,
    overdue: counts.overdue,
    assigned,
    unassigned: activeItems.length - assigned,
    dueSoon,
    byOwner,
    byDue,
    assignees,
  };
}

// ── F6: benchmark vs the Ascent corpus ────────────────────────────────────────

export interface OrgBenchmark {
  corpusRepos: number; // repos in the comparison corpus (other orgs)
  /** What the corpus was filtered to — carried so every surface that renders a percentile can state
   *  the basis rather than implying "every repo Ascent has ever seen". `rubric` is the scoring rubric
   *  version both sides were required to match; `excludesMockEngine` records that deterministic-floor
   *  scans were held out. A percentile without its basis is not an auditable number. */
  corpusBasis: { rubric: string; excludesMockEngine: true };
  overallPercentile: number | null; // org mean overall vs OTHER ORGS' means (null below CORPUS_MIN peer orgs — a 1-org corpus would rank everyone 0th or 100th)
  corpusAvgOverall: number;
  corpusAvgAdoption: number;
  corpusAvgRigor: number;
  /** Peer cohort — corpus repos sharing this org's dominant primary language, for a "vs your peers"
   *  read (more meaningful than the whole corpus). Null when the org has no dominant language or no
   *  same-language peers exist; the percentiles are null below COHORT_MIN peer ORGS (too few to rank). */
  cohort: {
    language: string;
    repos: number;
    overallPercentile: number | null;
    adoptionPercentile: number | null;
    avgOverall: number;
  } | null;
}

/**
 * Which scans may enter a percentile comparison.
 *
 * A percentile is a claim that two numbers were produced the same way. Two things break that, and both
 * were silently in the corpus before this filter existed:
 *
 * 1. **Engine.** A `mock` scan is the deterministic rubric with NO model nuance — the keyless/demo floor
 *    (`docs/features/scanning/llm-providers.md`). Seeded demo orgs and keyless deploys both produce them
 *    in bulk, so the corpus was partly a different scoring function, ranked as if it were a peer.
 * 2. **Rubric version.** Weights and detectors change; `SCORING_RUBRIC_VERSION` is stamped on each scan
 *    precisely so a pre-bump score is identifiable. Nothing re-bases persisted scans, so an old-rubric
 *    row is a number from a retired instrument. `null` (legacy, pre-stamping) is excluded for the same
 *    reason — unknown provenance is not evidence of comparability.
 *
 * Applied to BOTH sides: filtering only the corpus would rank this org's mock-scored repos against a
 * live-scored corpus, which is the same error mirrored.
 */
const BENCHMARK_ELIGIBLE = {
  engineProvider: { not: "mock" },
  rubricVersion: SCORING_RUBRIC_VERSION,
} as const;

/** The rendered form of BENCHMARK_ELIGIBLE, returned with every benchmark so a percentile always
 *  travels with the basis it was computed on. */
const CORPUS_BASIS = { rubric: SCORING_RUBRIC_VERSION, excludesMockEngine: true } as const;

/** Minimum same-language peer ORGS before a cohort percentile is statistically worth showing. */
const COHORT_MIN = 5;
/** Upper bound on the cross-tenant corpus materialized into Node for a benchmark (fleet-rollups-insights
 *  #5). The corpus is a percentile SAMPLE, not an exact population, so a bounded recent slice is enough —
 *  and it caps the cross-org read so one tenant's benchmark can't pull the entire fleet into memory. */
const BENCHMARK_CORPUS_CAP = 5000;
/** Minimum peer-org count before the headline percentile is worth showing — same discipline as
 *  COHORT_MIN: a 1–4 org corpus yields a confidently-wrong "you beat 100% of orgs". (Percentiles
 *  now rank org-mean vs other-org-means, so the floor counts ORGS, not repos.) */
const CORPUS_MIN = 5;

/** Share of `xs` at-or-below `v`, as 0..100 — null below `min` samples, because a 1-repo corpus
 *  ranks everyone a hard 0th or 100th percentile (no-sample is not a rank). Pure, for unit tests. */
export function percentileOf(xs: readonly number[], v: number, min = 1): number | null {
  if (xs.length < Math.max(1, min)) return null;
  return Math.round((xs.filter((x) => x <= v).length / xs.length) * 100);
}

/** Compare an org's averages against every other repo Ascent has scored (the corpus), plus a
 *  same-language peer cohort for a sharper "vs your peers" read. */
export async function getOrgBenchmark(orgSlug: string): Promise<OrgBenchmark | null> {
  if (!isDbConfigured()) return null;
  const prisma = getPrisma();
  const org = await getOrgBySlug(orgSlug);
  if (!org) return null;

  // Latest scan + primary language per repo, for every repo NOT in this org. `orgId` is carried so the
  // percentile comparison can be done org-vs-org (like-for-like), not org-mean-vs-repo-distribution.
  // Capped + filtered (fleet-rollups-insights #5): the old query pulled EVERY other org's repos (and
  // their latest scan) into Node uncapped — a cross-tenant memory blow-up that grows with the whole
  // corpus, not this tenant. Bound it to the most-recently-active CORPUS_CAP scored repos (`updatedAt`
  // bumps on every scan upsert) and require `scans: { some: {} }` so the cap budget isn't spent on
  // never-scanned repos the loop below discards anyway. A representative recent sample, not the universe.
  // Both the `some` predicate and the per-repo `take: 1` are filtered by BENCHMARK_ELIGIBLE, so the cap
  // budget is spent on comparable repos and each repo contributes its latest ELIGIBLE scan rather than
  // its latest scan (a repo whose most recent run degraded to mock still counts, via its last real one).
  // TENANCY (G4-02): the corpus is OTHER tenants' data, so it is restricted to `isPrivate: false`.
  // Without it, another org's PRIVATE repo scores fed corpusAvg*/the percentile that this org reads
  // back on /portfolio, in the digest and in the Executive Briefing PDF — a cross-tenant leak of
  // exactly the repos a tenant marked as not-for-sharing (aggregated, but still derived from them,
  // and observable: a small corpus moves measurably when one private repo enters it). Public repos
  // are already world-readable, so they are the only defensible corpus. This org's OWN side (the
  // `mine` query below) is deliberately unfiltered — an org is always entitled to its own repos.
  const repos = await prisma.repository.findMany({
    where: { orgId: { not: org.id }, isPrivate: false, scans: { some: BENCHMARK_ELIGIBLE } },
    orderBy: { updatedAt: "desc" },
    take: BENCHMARK_CORPUS_CAP,
    select: {
      orgId: true,
      primaryLanguage: true,
      scans: {
        where: BENCHMARK_ELIGIBLE,
        orderBy: { scannedAt: "desc" },
        take: 1,
        select: { overallScore: true, adoptionScore: true, rigorScore: true },
      },
    },
  });
  const corpus: { orgId: string; lang: string | null; overall: number; adoption: number; rigor: number }[] = [];
  for (const r of repos) {
    const s = r.scans[0];
    if (s) corpus.push({ orgId: r.orgId, lang: r.primaryLanguage, overall: s.overallScore, adoption: s.adoptionScore, rigor: s.rigorScore });
  }
  if (corpus.length === 0) {
    return { corpusRepos: 0, corpusBasis: CORPUS_BASIS, overallPercentile: null, corpusAvgOverall: 0, corpusAvgAdoption: 0, corpusAvgRigor: 0, cohort: null };
  }

  // This org's averages + dominant language (latest scan per repo).
  const mine = await prisma.repository.findMany({
    where: { orgId: org.id },
    select: {
      primaryLanguage: true,
      scans: {
        where: BENCHMARK_ELIGIBLE, // same instrument on both sides, or the comparison means nothing
        orderBy: { scannedAt: "desc" },
        take: 1,
        select: { overallScore: true, adoptionScore: true },
      },
    },
  });
  const myOverall: number[] = [];
  const myAdoption: number[] = [];
  const langCounts = new Map<string, number>();
  for (const r of mine) {
    const s = r.scans[0];
    if (!s) continue;
    myOverall.push(s.overallScore);
    myAdoption.push(s.adoptionScore);
    if (r.primaryLanguage) langCounts.set(r.primaryLanguage, (langCounts.get(r.primaryLanguage) ?? 0) + 1);
  }

  const avg = roundedMean;
  const myAvgOverall = mean(myOverall);
  const myAvgAdoption = mean(myAdoption);

  // Per-ORG means over a corpus slice — so the org's mean is ranked against OTHER ORGS' means
  // (population-vs-population), not against a per-repo distribution. Bug-fix (fleet-rollups-insights
  // #2): a mean of N repos is far less variable than individual repos, so percentile-ing one
  // aggregated number inside an un-aggregated repo distribution biased every org toward the middle
  // (a unit mismatch: scalar-vs-population). Now both the org and its peers are summarized the same way.
  const orgMeans = (rows: typeof corpus, pick: (c: (typeof corpus)[number]) => number): number[] => {
    const byOrg = new Map<string, { sum: number; n: number }>();
    for (const c of rows) {
      const e = byOrg.get(c.orgId) ?? { sum: 0, n: 0 };
      e.sum += pick(c);
      e.n += 1;
      byOrg.set(c.orgId, e);
    }
    return [...byOrg.values()].map((e) => e.sum / e.n);
  };

  // Peer cohort = corpus repos in the org's dominant language.
  const domLang = [...langCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  let cohort: OrgBenchmark["cohort"] = null;
  if (domLang) {
    const peers = corpus.filter((c) => c.lang === domLang);
    if (peers.length > 0) {
      // Rank this org's mean against peer ORG means within the language (not peer repos).
      const peerOrgOverall = orgMeans(peers, (p) => p.overall);
      const peerOrgAdoption = orgMeans(peers, (p) => p.adoption);
      cohort = {
        language: domLang,
        repos: peers.length,
        overallPercentile: percentileOf(peerOrgOverall, myAvgOverall, COHORT_MIN),
        adoptionPercentile: percentileOf(peerOrgAdoption, myAvgAdoption, COHORT_MIN),
        avgOverall: avg(peers.map((p) => p.overall)),
      };
    }
  }

  return {
    corpusRepos: corpus.length,
    corpusBasis: CORPUS_BASIS,
    // Org mean vs other orgs' means (CORPUS_MIN is now a floor on the number of peer ORGS, not repos).
    overallPercentile: percentileOf(orgMeans(corpus, (c) => c.overall), myAvgOverall, CORPUS_MIN),
    corpusAvgOverall: avg(corpus.map((c) => c.overall)),
    corpusAvgAdoption: avg(corpus.map((c) => c.adoption)),
    corpusAvgRigor: avg(corpus.map((c) => c.rigor)),
    cohort,
  };
}

// ── P2: Practice Library — capture & reuse best practices across the org ──────

export interface OrgPractice {
  id: string;
  label: string;
  dimId: string;
  what: string;
  starter: string[];
  total: number; // repos scored on this dimension
  strongCount: number; // repos that embody the practice (score ≥ 70)
  exemplar: { name: string; fullName: string; score: number } | null; // learn from this one
  gapRepos: string[]; // repos that could adopt it (score < 40) — display names
  gapRepoRefs: { name: string; fullName: string }[]; // same repos with fullName, for "apply" actions
  /**
   * The lifecycle of the starter PRs this practice has actually opened (ImprovementPr rows, the same
   * machinery the war room drives) — in flight, landed, and the measured average dimension lift of
   * the merged-and-verified ones. Absent when the practice has never been applied in this org, so a
   * never-applied row shows no rollout chrome at all. `lift` is null until a post-merge rescan lands.
   */
  prs?: { open: number; merged: number; lift: number | null };
  /** The repos with a still-open starter PR for this practice — so apply offers a link, not a duplicate. */
  openPrs?: { repoFullName: string; prNumber: number; prUrl: string }[];
}

const STRONG = 70;
const GAP = 40;

/** Fold ImprovementPr rows into the per-practice `prs` / `openPrs` projection. Pure. */
export function summarizePracticePrs(
  rows: { practiceId: string; repoFullName: string; prNumber: number; prUrl: string; state: string; impactDim: number | null }[],
): Map<string, { prs: NonNullable<OrgPractice["prs"]>; openPrs: NonNullable<OrgPractice["openPrs"]> }> {
  const out = new Map<string, { prs: { open: number; merged: number; lift: number | null }; openPrs: { repoFullName: string; prNumber: number; prUrl: string }[]; liftSum: number; liftN: number }>();
  for (const r of rows) {
    const e =
      out.get(r.practiceId) ?? { prs: { open: 0, merged: 0, lift: null }, openPrs: [], liftSum: 0, liftN: 0 };
    if (r.state === "open") {
      e.prs.open += 1;
      e.openPrs.push({ repoFullName: r.repoFullName, prNumber: r.prNumber, prUrl: r.prUrl });
    } else if (r.state === "merged") {
      e.prs.merged += 1;
      // Only VERIFIED merges carry an impactDim; an awaiting-rescan merge must not drag the average
      // toward zero (a null is "not measured yet", never "no effect").
      if (r.impactDim != null) {
        e.liftSum += r.impactDim;
        e.liftN += 1;
      }
    }
    out.set(r.practiceId, e);
  }
  const summary = new Map<string, { prs: NonNullable<OrgPractice["prs"]>; openPrs: NonNullable<OrgPractice["openPrs"]> }>();
  for (const [id, e] of out) {
    summary.set(id, {
      prs: { open: e.prs.open, merged: e.prs.merged, lift: e.liftN > 0 ? Math.round(e.liftSum / e.liftN) : null },
      openPrs: e.openPrs,
    });
  }
  return summary;
}

/**
 * A repo's latest-scan dimension scores, or null when the repo has no scan yet OR its latest scan has
 * an empty dimensions set (an incomplete/failed scan row). Shared by getOrgPractices and
 * getOrgGapAnalysis so a zero-dimension scan can't slip past one function's guard and not the other's
 * — they previously diverged (`!dims` vs `!dims?.length`), and `!dims?.length` is the CORRECT one:
 * an empty array is not "no scan" for iteration purposes, but a repo with zero recorded dimensions
 * has nothing usable for either function's per-dimension aggregates and must be excluded consistently
 * (getOrgGapAnalysis in particular counts `perRepo.length` as its scanned-population denominator).
 */
function repoDims(r: { scans: { dimensions: { dimId: string; score: number }[] }[] }): { dimId: string; score: number }[] | null {
  const dims = r.scans[0]?.dimensions;
  return dims?.length ? dims : null;
}

/** The org's playbook: for each practice, who exemplifies it and who could adopt it next. */
export async function getOrgPractices(orgSlug: string, segmentId?: string | null, techGroupId?: string | null): Promise<OrgPractice[] | null> {
  if (!isDbConfigured()) return null;
  const prisma = getPrisma();
  const org = await getOrgBySlug(orgSlug);
  if (!org) return null;

  // Two org-scoped reads in parallel — the repo/dimension projection and ONE flat aggregate of every
  // starter PR this org has opened (folded per-practice in memory). No per-practice or per-repo query:
  // the PR read is a single indexed org lookup regardless of fleet or practice count.
  const [repos, prRows] = await Promise.all([
    prisma.repository.findMany({
      where: { orgId: org.id, ...segmentScope(segmentId), ...techGroupScope(techGroupId) },
      select: {
        name: true,
        fullName: true,
        scans: { orderBy: { scannedAt: "desc" }, take: 1, select: { dimensions: { select: { dimId: true, score: true } } } },
      },
    }),
    prisma.improvementPr.findMany({
      where: { orgId: org.id },
      select: { practiceId: true, repoFullName: true, prNumber: true, prUrl: true, state: true, impactDim: true },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  // Per-dimension list of {repo, score} from each repo's latest scan.
  const byDim = new Map<string, { name: string; fullName: string; score: number }[]>();
  for (const r of repos) {
    const dims = repoDims(r);
    if (!dims) continue;
    for (const d of dims) {
      const arr = byDim.get(d.dimId) ?? [];
      arr.push({ name: r.name, fullName: r.fullName, score: d.score });
      byDim.set(d.dimId, arr);
    }
  }
  if (byDim.size === 0) return null;

  // Keep the PR projection inside the SAME slice the page is showing — a segment/tech-group filter
  // must not leak counts for repos the viewer filtered out.
  const inScope = new Set(repos.map((r) => r.fullName));
  const prsByPractice = summarizePracticePrs(prRows.filter((r) => inScope.has(r.repoFullName)));

  const practices: OrgPractice[] = PRACTICES.map((p) => {
    const rows = (byDim.get(p.dimId) ?? []).slice().sort((a, b) => b.score - a.score);
    const top = rows[0];
    const pr = prsByPractice.get(p.id);
    return {
      id: p.id,
      label: p.label,
      dimId: p.dimId,
      what: p.what,
      starter: p.starter,
      total: rows.length,
      strongCount: rows.filter((r) => r.score >= STRONG).length,
      exemplar: top && top.score >= STRONG ? { name: top.name, fullName: top.fullName, score: top.score } : null,
      gapRepos: rows.filter((r) => r.score < GAP).map((r) => r.name),
      gapRepoRefs: rows.filter((r) => r.score < GAP).map((r) => ({ name: r.name, fullName: r.fullName })),
      ...(pr ? { prs: pr.prs, openPrs: pr.openPrs } : {}),
    };
  });

  // Biggest reuse opportunity first: practices with an exemplar to copy AND many repos lacking it.
  return practices.sort((a, b) => {
    const aOpp = (a.exemplar ? 1 : 0) * a.gapRepos.length;
    const bOpp = (b.exemplar ? 1 : 0) * b.gapRepos.length;
    return bOpp - aOpp || b.gapRepos.length - a.gapRepos.length;
  });
}

// ── Cross-repo gap analysis — common org gaps vs repo-specific ────────────────

export interface CommonGap {
  dimId: string;
  label: string;
  weakCount: number; // repos weak on this dimension
  total: number;
  avg: number; // org average for the dimension
  practiceId: string | null; // link into the Practice Library
  exemplar: { name: string; fullName: string; score: number } | null; // who already nails it
}

export interface RepoOutlier {
  fullName: string;
  name: string;
  dimId: string;
  label: string;
  score: number;
  orgAvg: number;
  delta: number; // how far below the org this repo sits
}

export interface OrgGapAnalysis {
  scanned: number;
  commonGaps: CommonGap[]; // systemic — fix once, apply across the fleet
  repoSpecific: RepoOutlier[]; // outliers — a repo lags what the rest of the org has handled
  /** The population floor this fleet was measured against (GAP_MIN_REPOS). Below it both lists are
   *  empty and the surface must say "too few repos" rather than present a classification. */
  minRepos: number;
}

const GAP_SCORE = 45; // a repo is "weak" on a dimension below this
const COMMON_RATIO = 0.5; // weak in ≥ half the repos → a common org gap
const OUTLIER_DELTA = 18; // repo lags the org average by this much → repo-specific
const HEALTHY_AVG = 50; // …while the org generally handles that dimension

/**
 * Minimum scanned repos before the org-vs-repo split is a real reading rather than an artifact of a
 * tiny fleet. Chosen as 3 to match CHAMPION_MIN_POP (`@/components/org/shared/champions`) — the
 * codebase's floor for "is this pattern real WITHIN one org's own population". The other floors,
 * CORPUS_MIN / COHORT_MIN = 5, gate ranking a fleet against OTHER ORGS, which is a different (and
 * larger) sampling problem; borrowing 5 here would mute the decomposition for most real fleets.
 *
 * 3 is also the smallest N where neither half of the split can be produced by a single repo:
 *  - at N = 2, one weak repo is already "weak in ≥ half the fleet" (COMMON_RATIO = 0.5) and gets
 *    reported as a SYSTEMIC ORG GAP — the most expensive possible misread, since the answer is
 *    "roll out a practice across the fleet" when the truth is "one repo is behind";
 *  - at N = 2, an "outlier" is just the lower of two repos measured against an average it itself
 *    half-defines, so the org-handles-it-generally premise of HEALTHY_AVG doesn't hold either.
 * This is a POPULATION guard, not a re-calibration: the thresholds above are untouched.
 */
export const GAP_MIN_REPOS = 3;

/**
 * Discriminated reason behind a bare `null` from getOrgPractices/getOrgGapAnalysis (and the several
 * sibling org-insight functions with the identical `!isDbConfigured() → null; !org → null` shape,
 * G4-21): "disabled" (no DATABASE_URL — a deployment/config problem), "not_found" (the slug doesn't
 * resolve to an org — a routing/typo problem), or "ok" (safe to call the real function; it may still
 * legitimately return an empty-but-non-null shape for zero scanned repos). A caller that needs to tell
 * "go scan some repos" apart from "this deployment is misconfigured" apart from "this org doesn't
 * exist" should call this FIRST rather than pattern-matching the target function's `null`, which
 * collapses all three into one value. Not wired into every call site (that would be an app-wide,
 * signature-breaking rewrite well beyond this fix's scope) — provided so new/fixed call sites have a
 * real way to disambiguate instead of inheriting the ambiguity.
 */
export async function orgInsightAvailability(orgSlug: string): Promise<"disabled" | "not_found" | "ok"> {
  if (!isDbConfigured()) return "disabled";
  const org = await getOrgBySlug(orgSlug);
  return org ? "ok" : "not_found";
}

/**
 * Separate **common organization gaps** (weak across most repos — fix once, systematically) from
 * **repo-specific gaps** (a repo lagging what the rest of the org already handles). The headline
 * cross-repo insight: is this an org problem or a repo problem?
 *
 * NOTE (G4-21): `null` here is a collapsed sentinel — it means "DB not configured" OR "org not found",
 * with no way for a caller to tell them apart. Use `orgInsightAvailability` first if that distinction
 * matters to the caller.
 */
export async function getOrgGapAnalysis(orgSlug: string, segmentId?: string | null, techGroupId?: string | null): Promise<OrgGapAnalysis | null> {
  if (!isDbConfigured()) return null;
  const prisma = getPrisma();
  const org = await getOrgBySlug(orgSlug);
  if (!org) return null;

  const repos = await prisma.repository.findMany({
    where: { orgId: org.id, ...segmentScope(segmentId), ...techGroupScope(techGroupId) },
    select: {
      name: true,
      fullName: true,
      scans: { orderBy: { scannedAt: "desc" }, take: 1, select: { dimensions: { select: { dimId: true, score: true } } } },
    },
  });

  // Per dimension: [{repo, score}]. Per repo: its dim→score map.
  const byDim = new Map<string, { name: string; fullName: string; score: number }[]>();
  const perRepo: { name: string; fullName: string; dims: Record<string, number> }[] = [];
  for (const r of repos) {
    const dims = repoDims(r);
    if (!dims) continue;
    const map: Record<string, number> = {};
    for (const d of dims) {
      map[d.dimId] = d.score;
      const arr = byDim.get(d.dimId) ?? [];
      arr.push({ name: r.name, fullName: r.fullName, score: d.score });
      byDim.set(d.dimId, arr);
    }
    perRepo.push({ name: r.name, fullName: r.fullName, dims: map });
  }
  const scanned = perRepo.length;
  if (scanned === 0) return null;
  // Population guard (see GAP_MIN_REPOS): report the count and classify NOTHING. A 2-repo fleet with
  // one weak repo would otherwise clear COMMON_RATIO and be told it has a systemic org gap.
  if (scanned < GAP_MIN_REPOS) return { scanned, commonGaps: [], repoSpecific: [], minRepos: GAP_MIN_REPOS };

  const dimAvg: Record<string, number> = {};
  const commonGaps: CommonGap[] = [];
  for (const [dimId, rows] of byDim) {
    const avg = Math.round(rows.reduce((a, b) => a + b.score, 0) / rows.length);
    dimAvg[dimId] = avg;
    const weakCount = rows.filter((r) => r.score < GAP_SCORE).length;
    if (weakCount / rows.length >= COMMON_RATIO) {
      const top = [...rows].sort((a, b) => b.score - a.score)[0];
      commonGaps.push({
        dimId,
        label: DIMENSION_BY_ID[dimId as DimensionId]?.name ?? dimId,
        weakCount,
        total: rows.length,
        avg,
        practiceId: PRACTICES.find((p) => p.dimId === dimId)?.id ?? null,
        exemplar: top && top.score >= 70 ? { name: top.name, fullName: top.fullName, score: top.score } : null,
      });
    }
  }
  commonGaps.sort((a, b) => b.weakCount - a.weakCount || a.avg - b.avg);

  // Repo-specific: a repo well below the org average on a dimension the org generally handles.
  const repoSpecific: RepoOutlier[] = [];
  for (const r of perRepo) {
    for (const [dimId, score] of Object.entries(r.dims)) {
      const orgAvg = dimAvg[dimId] ?? 0;
      const delta = orgAvg - score;
      if (orgAvg >= HEALTHY_AVG && delta >= OUTLIER_DELTA) {
        repoSpecific.push({
          fullName: r.fullName,
          name: r.name,
          dimId,
          label: DIMENSION_BY_ID[dimId as DimensionId]?.name ?? dimId,
          score,
          orgAvg,
          delta,
        });
      }
    }
  }
  // Stable tiebreak (fleet-rollups-insights #6): equal-delta outliers otherwise slice(0,12) in arbitrary
  // order, so which outliers survive the cap could differ run-to-run. fullName then dimId make it fixed.
  repoSpecific.sort((a, b) => b.delta - a.delta || a.fullName.localeCompare(b.fullName) || a.dimId.localeCompare(b.dimId));

  return { scanned, commonGaps, repoSpecific: repoSpecific.slice(0, 12), minRepos: GAP_MIN_REPOS };
}

// ── Calibration: LLM-as-auditor detector backlog ──────────────────────────────
// The scan's LLM auditor flags signals it believes the deterministic detectors got wrong
// (`Scan.discrepancies`). Aggregated across the fleet, recurring claims for one dimension are a
// prioritized backlog of detector improvements — the loop that keeps the core IP calibrated.

export interface DiscrepancyGroup {
  dimId: string;
  label: string;
  count: number; // total times flagged across the fleet
  repos: string[]; // repos where this dimension was flagged
  examples: string[]; // distinct sample claims (capped)
}

export interface OrgDiscrepancies {
  scanned: number; // repos with a latest scan
  flaggedRepos: number; // repos with ≥1 auditor flag
  total: number; // total flags
  groups: DiscrepancyGroup[]; // by dimension, most-flagged first
}

/** Aggregate the LLM auditor's suspected detector misses across the fleet → a detector backlog. */
export async function getOrgDiscrepancies(orgSlug: string): Promise<OrgDiscrepancies | null> {
  if (!isDbConfigured()) return null;
  const prisma = getPrisma();
  const org = await getOrgBySlug(orgSlug);
  if (!org) return null;

  const repos = await prisma.repository.findMany({
    where: { orgId: org.id },
    select: { name: true, scans: { orderBy: { scannedAt: "desc" }, take: 1, select: { discrepancies: true } } },
  });

  const groups = new Map<string, { count: number; repos: Set<string>; examples: Set<string> }>();
  let scanned = 0;
  let total = 0;
  const flagged = new Set<string>();

  for (const r of repos) {
    const raw = r.scans[0]?.discrepancies;
    if (raw == null) continue;
    scanned += 1;
    let parsed: { dimension?: unknown; claim?: unknown }[] = [];
    try {
      const p = JSON.parse(raw);
      if (Array.isArray(p)) parsed = p;
    } catch {
      continue;
    }
    for (const d of parsed) {
      if (typeof d.dimension !== "string" || typeof d.claim !== "string") continue;
      const g = groups.get(d.dimension) ?? { count: 0, repos: new Set<string>(), examples: new Set<string>() };
      g.count += 1;
      g.repos.add(r.name);
      if (g.examples.size < 4) g.examples.add(d.claim.trim());
      groups.set(d.dimension, g);
      total += 1;
      flagged.add(r.name);
    }
  }
  if (scanned === 0) return null;

  const out: DiscrepancyGroup[] = [...groups.entries()]
    .map(([dimId, g]) => ({
      dimId,
      label: DIMENSION_BY_ID[dimId as DimensionId]?.name ?? dimId,
      count: g.count,
      repos: [...g.repos].sort(),
      examples: [...g.examples],
    }))
    .sort((a, b) => b.count - a.count || b.repos.length - a.repos.length);

  return { scanned, flaggedRepos: flagged.size, total, groups: out };
}
