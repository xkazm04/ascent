// Org rollup: org-id resolution, per-repo watch/level state, and the org-rollup query that powers
// the dashboard. All guarded by DATABASE_URL.
//
// WHAT THE WINDOW MEANS HERE — every reader in the org-*.ts family takes the same half-open
// `[start, endExclusive)` bounds (`orgWindowBounds` in src/lib/org/period.ts), but they pick DIFFERENT
// endpoints out of it, and that difference is deliberate:
//   - getOrgRollup — "current" is each repo's LATEST SCAN AT-OR-BEFORE the upper bound, with NO lower
//     bound (see the `scans: { where: upper … }` sub-select below). The rollup answers "where does the
//     fleet stand as of the end of this period", so a repo last scanned before `start` still carries
//     its most recent score into the fleet average. `start` bounds only the trend/baseline queries.
//   - getOrgRepoHistories — EVERY scan inside the window, not an endpoint: it is a series, not a state.
//   - getOrgMovers (org-insights.ts) / getOrgTeamRollup (org-teams.ts) — "now" is the latest scan
//     INSIDE the window, because a move is a before/after MEASUREMENT and both ends must be real.
// The visible consequence: a repo not scanned during the period counts in the rollup average and does
// not appear in movers. The two are not expected to reconcile. (Pinned by src/lib/org/period.dialect.test.ts.)

import { cache } from "react";
import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { forecastTrajectory, type Forecast } from "@/lib/maturity/forecast";
import { levelForScore } from "@/lib/maturity/model";
import { GroupedMean, dateRange, getOrgBySlug, normalizeOrgSlug, roundedMean, segmentScope, techGroupScope, upperBound } from "@/lib/db/org-shared";
import { retentionCutoff } from "@/lib/plans";
import { parseTechStackJson } from "@/lib/analyze/tech-extract";
import { applyPassportOverrides, parsePassportJson, parsePassportOverrides } from "@/lib/analyze/passport";
import { parseContextHealthJson } from "@/lib/analyze/context-health";
import { parseGuidanceGraphJson } from "@/lib/analyze/guidance-graph";
import { parseManifestReadoutJson, type ManifestReadout } from "@/lib/standard/readout";
import { parsePlatformSignals, unmeasurablePlatformDims } from "@/lib/analyze/platform-carry";
import type { AppPassport, ContextHealth, GuidanceGraph, PrStats, TechStack } from "@/lib/types";

/** Pull just the two branch-protection fields the fleet gate needs out of a persisted governance
 *  JSON blob. Returns undefined for a null/missing/malformed blob (no-token scan, parse error) so the
 *  gate leaves `requireProtectedBranch` unevaluated rather than false-failing. */
function parseGovernanceLite(raw: string | null | undefined): { readable: boolean; protected: boolean } | undefined {
  if (!raw) return undefined;
  try {
    const g = JSON.parse(raw) as { readable?: unknown; protected?: unknown };
    if (typeof g.readable !== "boolean") return undefined;
    return { readable: g.readable, protected: g.protected === true };
  } catch {
    return undefined;
  }
}

/**
 * W2 — the provenance signal the fleet gate's `minAiGovernedRate` bar reads, pulled from the same
 * persisted `prStats` blob everything else on this row already parses.
 *
 * Returns undefined for a missing/malformed blob and NULLs the rate when the engine itself declined
 * to compute one (no token, or under its ≥5 AI-PR sample floor). Both cases must reach the gate as
 * "not measurable" so the criterion is SKIPPED — failing a repo for having too little AI activity
 * would invert the policy this bar exists to express. `aiPrSample` reconstructs the AI-PR count from
 * the rate the engine stored, purely so a failure message can say what it was measured over.
 */
function parseProvenanceLite(raw: string | null | undefined): { aiGovernedRate: number | null; aiPrSample: number | null } | undefined {
  if (!raw) return undefined;
  try {
    const p = JSON.parse(raw) as Partial<PrStats>;
    if (!p || typeof p.analyzed !== "number") return undefined;
    const rate = typeof p.aiGovernedRate === "number" && Number.isFinite(p.aiGovernedRate) ? p.aiGovernedRate : null;
    const involved =
      typeof p.aiInvolvedRate === "number" && Number.isFinite(p.aiInvolvedRate)
        ? Math.round((p.aiInvolvedRate / 100) * p.analyzed)
        : null;
    return { aiGovernedRate: rate, aiPrSample: involved };
  } catch {
    return undefined;
  }
}

/** The Repositories table's commit window: the trailing weekly buckets kept for the Commits column,
 *  ~1 month. The scan persists a longer series (governance.fetchCommitActivity → ~12 weeks, also fed to
 *  the Delivery trend); we slice the last month HERE so this column reads as a 1-month figure without
 *  shrinking Delivery's longer trend. Existing scans get the 1-month view immediately — no re-scan. */
const ACTIVITY_WEEKS = 4;

/**
 * The deterministic mock FLOOR — the placeholder score the scanner emits when it never called a
 * model. Not a grade: averaging it into a figure presented as a measurement reports a measurement
 * over a set that was partly never measured.
 *
 * The predicate lives HERE, at the producer, because that is where the exclusion has to happen for
 * every consumer to inherit it. The cohort card's client-side twin (`isMockEngine` in
 * `src/features/standing/overview/repoTrajectory.ts`) already held this rule for the numbers it
 * derives itself; `src/lib/**` may not import from `src/features/**`, so the one line is restated
 * rather than shared. Both read the same persisted `Scan.engineProvider`.
 *
 * EXPORTED (fleet-rollups-insights: aggregate honesty) so every sibling READER inherits the one
 * predicate instead of restating it: `getOrgMovers` (org-insights.ts) and `getOrgTeamRollup`
 * (org-teams.ts) both fold scores, and both used to fold the mock floor while this file refused it —
 * so the same fleet reported a mock→live re-scan as a top gainer in Fix-first/the digest/the Exec
 * Briefing while the badge above it excluded exactly that pair. One predicate, one meaning of "was
 * this ever measured". It lives here rather than in org-shared.ts because this is the producer that
 * defines the exclusion, and org-shared.ts carries no scoring semantics at all.
 */
const MOCK_ENGINE = "mock";
export function isMockScore(engine: string | null | undefined): boolean {
  return engine === MOCK_ENGINE;
}

/**
 * Project the repo-activity signals (weekly commits + PR volume + LoC changed) out of a scan's
 * persisted GitHub blobs, for the Repositories table's activity columns. Both blobs are already
 * ingested at scan time (commitActivity + prStats) — no extra GitHub calls. Returns null when the
 * latest scan carries NEITHER (a tokenless or mock scan never ingested them), so the UI renders "—"
 * instead of a fabricated zero. Defensive parse mirrors org-signals.ts (getOrgActivity / getOrgPrSignals).
 */
function parseRepoActivity(commitActivity: string | null | undefined, prStats: string | null | undefined): OrgRepoRow["activity"] {
  let commitsWeekly: number[] = [];
  if (commitActivity) {
    try {
      const arr = JSON.parse(commitActivity);
      // Last ~1 month of weekly buckets (newest kept) — the Commits column is a 1-month read.
      if (Array.isArray(arr)) commitsWeekly = arr.filter((n): n is number => typeof n === "number" && Number.isFinite(n)).slice(-ACTIVITY_WEEKS);
    } catch {
      /* ignore malformed */
    }
  }
  let pr: { prsMerged: number; prsTotal: number; locChanged: number } | null = null;
  if (prStats) {
    try {
      const p = JSON.parse(prStats) as PrStats;
      if (p && typeof p.analyzed === "number") {
        pr = {
          prsMerged: p.merged ?? 0,
          prsTotal: p.totalCount ?? p.analyzed,
          // avgLineChanges is per-PR (additions+deletions); × analyzed ≈ LoC over the analyzed window.
          locChanged: Math.round((p.avgLineChanges ?? 0) * p.analyzed),
        };
      }
    } catch {
      /* ignore malformed */
    }
  }
  if (!commitsWeekly.length && !pr) return null;
  return {
    commitsWeekly,
    prsMerged: pr?.prsMerged ?? 0,
    prsTotal: pr?.prsTotal ?? 0,
    locChanged: pr?.locChanged ?? 0,
  };
}

/**
 * Resolve an org slug to its id (the tenant scope), or null when it doesn't exist. The slug is
 * canonicalized (trimmed + lower-cased) before the lookup because org rows are PERSISTED with a
 * lower-cased slug — the authoritative writer is the GitHub-App install flow (upsertInstallation,
 * `const slug = opts.login.toLowerCase()`). Canonicalizing here makes every caller's lookup hit
 * regardless of whether it pre-lowercased, and lets members.ts / invites.ts share this one resolver
 * instead of each maintaining a privately-drifting copy.
 */
export async function getOrgId(slug: string): Promise<string | null> {
  if (!isDbConfigured()) return null;
  return (await getOrgBySlug(slug))?.id ?? null;
}

export interface RepoState {
  watched: boolean;
  scanSchedule: string;
  level: string | null;
  overall: number | null;
}

/** Per-fullName watch/schedule/latest-level state, to merge into an installation listing. */
export async function getRepoStates(orgSlug: string): Promise<Record<string, RepoState>> {
  if (!isDbConfigured()) return {};
  const prisma = getPrisma();
  const orgId = await getOrgId(orgSlug);
  if (!orgId) return {};
  const repos = await prisma.repository.findMany({
    where: { orgId },
    select: {
      fullName: true,
      watched: true,
      scanSchedule: true,
      scans: { orderBy: { scannedAt: "desc" }, take: 1, select: { level: true, overallScore: true } },
    },
  });
  const out: Record<string, RepoState> = {};
  for (const r of repos)
    out[r.fullName] = {
      watched: r.watched,
      scanSchedule: r.scanSchedule,
      level: r.scans[0]?.level ?? null,
      overall: r.scans[0]?.overallScore ?? null,
    };
  return out;
}

export interface OrgRepoRow {
  fullName: string;
  owner: string;
  name: string;
  isPrivate: boolean;
  watched: boolean;
  /** GitHub's detected primary language, or null — drives auto-segments by language. */
  primaryLanguage: string | null;
  /** Detected tech stack (Feature 3a), cached from the latest scan — null until first scan / if absent.
   *  Drives tech badges on the leaderboard + tech-based grouping. */
  techStack: TechStack | null;
  /** App Readiness Passport cached from the latest scan — null until first scan / if absent. Drives the
   *  portfolio passports view (the two readiness axes + named stack). */
  passport: AppPassport | null;
  /** Context Health (W4) cached from the latest scan — guidance-file freshness/quality/drift, the
   *  Half-life panel's per-repo input. Null when the latest scan PREDATES the signal (or on parse
   *  failure), which the UI must render as "not assessed by this scan — re-scan", never as absent. */
  contextHealth: ContextHealth | null;
  /** What the latest scan read in this repo's OWN `.ai/manifest.yaml` (#13) — declared capabilities,
   *  the doctor's proven `verified` flags, and where each control is placed. Null when the latest scan
   *  predates the signal or the blob is unparseable, which the UI must render as "not assessed —
   *  re-scan" and exclude from every denominator, never as a repo that declares nothing. */
  manifest: ManifestReadout | null;
  /** The guidance arbiter's verdict cached from the latest scan (#15, rubric r11) — canonical source,
   *  projection states and contradictions. Null when the latest scan PREDATES r11 or the blob is
   *  unparseable: such a repo is excluded from the "repos with contradicting agent guidance"
   *  denominator and the label says so, because 0-of-unknown is not a measurement. */
  guidanceGraph: GuidanceGraph | null;
  /** Two-speed freshness (moonshot #10): when this repo was last SCORED (a paid LLM scan) and when
   *  its CONTROLS were last observed (a free probe). They move independently by design — the point of
   *  the two-speed fleet is that posture can be current while a score is a week old. Every field is
   *  null when the thing has never happened; the UI renders "—", never a fabricated "now". */
  freshness: {
    scoredAt: string | null;
    controlsAt: string | null;
    /** An unsettled `ScanJob` exists for this repo — a rescan is owed, not lost. */
    queued: boolean;
  };
  scanSchedule: string;
  lastScanAt: string | null;
  /** Outcome of the most recent scan attempt — "ok" | "error" | null (never attempted). */
  lastScanStatus: string | null;
  /** Failure reason when lastScanStatus is "error", for a "needs attention" affordance. */
  lastScanError: string | null;
  /** `.ai/` standard conformance % reported by the repo's doctor, or null if never reported. */
  aiConformance: number | null;
  /** Repo-activity signals projected from the latest scan's already-ingested GitHub blobs
   *  (commitActivity + prStats) — the Repositories table's activity columns. Null when the latest
   *  scan ingested neither (tokenless / mock scan), so the UI renders "—" not a fabricated zero. */
  activity: {
    /** Trailing ~1 month of weekly commit totals (GitHub commit_activity), oldest→newest; [] if not ingested. */
    commitsWeekly: number[];
    /** Merged PRs across the analyzed PR window. */
    prsMerged: number;
    /** Repo-wide PR count (PrStats.totalCount). */
    prsTotal: number;
    /** Lines changed (additions+deletions) across the analyzed PR window. */
    locChanged: number;
  } | null;
  latest: {
    level: string;
    overall: number;
    adoption: number;
    rigor: number;
    posture: string;
    scannedAt: string;
    /** The engine that produced this scan — "mock" = the deterministic floor (a placeholder score, not
     *  a real graded scan); anything else is a live model. Surfaced so the UI can flag mock provenance. */
    engine: string;
    dims: { dimId: string; score: number; signalScore?: number; llmScore?: number }[];
    /**
     * Dimensions this scan could NOT measure — D2/D3/D4 on a worktree/local scan that had no
     * GitHub-side fold to carry (src/lib/analyze/platform-carry.ts). Empty on every scan that could
     * see GitHub, and empty on a legacy row, where the question was never asked: unknown provenance
     * is not evidence that a dimension was unmeasurable, and reading it as such would quietly drop
     * three dimensions out of every historical green verdict.
     */
    unmeasurableDims?: string[];
    /**
     * This scan scored NOTHING — no dimension row was persisted, so `overall`/`level` are the
     * renormalized floor (0 / L1) rather than a measurement. Carried because the FLEET path scores
     * from these persisted numbers alone (evaluateGateLite), and without this flag it could not tell
     * an ingestion failure apart from a genuinely bad repo: the governance rollup's `incomplete`
     * tally was structurally pinned at 0, i.e. a count that could only ever read "none occurred".
     *
     * Derived, not stored: there is no `incomplete` column. `dimensions.length === 0` is the SAME
     * predicate the engine stamps the report's `incomplete` flag from (scoring/engine.ts:266) and the
     * same second arm `isIncompleteReport` (scoring/gate.ts) accepts for persisted/reconstructed
     * reports, so the fleet reading and the per-repo gate agree on what "unscorable" means.
     */
    incomplete: boolean;
    /** Whether a token saw the default branch's protection rules (governance.readable). Undefined
     *  when no governance blob was persisted. Lets the fleet gate enforce `requireProtectedBranch`
     *  with the SAME readable-gated semantics as the CI gate (evaluateGate). */
    govReadable?: boolean;
    /** Whether the default branch is protected (governance.protected), when readable. */
    protected?: boolean;
    /** W2 — share (0..100) of AI-attributed merged PRs with an approving human review
     *  (PrStats.aiGovernedRate). Null with no token and under the engine's ≥5 AI-PR sample floor.
     *  Carried so the fleet gate can enforce `minAiGovernedRate` with the SAME not-measurable
     *  semantics as the CI gate — otherwise the dashboard would show repos passing that CI blocks. */
    aiGovernedRate?: number | null;
    /** AI-attributed PRs behind that rate, for the failure message. */
    aiPrSample?: number | null;
  } | null;
}

/**
 * A time window for the org views. `start` doubles as the *baseline date* for period-over-period
 * deltas (the fleet snapshot we compare the present against); the upper bound bounds the present
 * (null = now). Omitting the window entirely preserves the all-time behavior (no baseline, full trend).
 *
 * INTERVALS ARE HALF-OPEN — `[start, endExclusive)`, the canonical org policy (`src/lib/org/timezone.ts`,
 * note 4) that `ResolvedWindow` already speaks. `endExclusive` is the bound to set; `end` remains only
 * for callers that have nothing but the inclusive last instant. When both are present `endExclusive`
 * wins (see `upperBound` in `org-shared.ts` for why `lte: end` is not equivalent under Postgres'
 * microsecond timestamps).
 */
export interface OrgWindow {
  start?: Date | null;
  /** Inclusive last instant. Legacy — prefer `endExclusive`. */
  end?: Date | null;
  /** Canonical half-open upper bound: the window is `[start, endExclusive)`. Wins over `end`. */
  endExclusive?: Date | null;
}

export interface OrgRollup {
  org: string;
  repoCount: number;
  scannedCount: number;
  /**
   * Mean of the latest overall score across the LIVE-SCORED repos — mock placeholders excluded (see
   * {@link isMockScore}). `realScoredCount` is its denominator and must be rendered beside it; when
   * that denominator is 0 this number is a division guard (0), NOT a grade, and every renderer must
   * land on its no-score path instead of printing it.
   */
  avgOverall: number;
  /** Same exclusion and same denominator as {@link OrgRollup.avgOverall}. */
  avgAdoption: number;
  /** Same exclusion and same denominator as {@link OrgRollup.avgOverall}. */
  avgRigor: number;
  /** Scanned repos carrying a real graded score — the denominator behind the three averages above
   *  and the cohort behind `deltas`/`movement`. A count travels with its predicate. */
  realScoredCount: number;
  /** Scanned repos whose latest score is the deterministic mock floor, EXCLUDED from every average
   *  and delta above. Nonzero obliges the surface to disclose it ("N mock excluded"). */
  mockCount: number;
  postureCounts: Record<string, number>;
  dimAverages: { dimId: string; avg: number }[];
  repos: OrgRepoRow[];
  trend: { date: string; avg: number }[];
  /** Forward-looking trajectory fit over `trend` — projected level + promotion/demotion ETA.
   * Null until there are at least two distinct scan days to fit a line through. */
  forecast: Forecast | null;
  /** Fleet snapshot as of the window's `start` (latest scan per repo at-or-before that date).
   * Null when no window start is given or no repo had been scanned by then. */
  baseline: {
    asOf: string; // ISO of the baseline date
    repos: number; // repos that had a scan by then
    avgOverall: number;
    avgAdoption: number;
    avgRigor: number;
  } | null;
  /** Cohort-matched current-minus-baseline for the headline metrics — the per-tile period delta.
   * Measured only over repos present on BOTH sides of the window, so onboarding repos mid-period
   * reads as growth, not fabricated score movement. Null without a baseline (or no overlap).
   * @deprecated Read {@link movement} instead — same three numbers, plus the cohort size they were
   * measured over. A delta rendered without its denominator can't be read. */
  deltas: { overall: number; adoption: number; rigor: number } | null;
  /** The same movement WITH its qualifiers: `cohortSize` (the matched denominator) and the excluded
   * composition change (`onboarded` / `departed`). Null on the same conditions as `deltas`. Any
   * surface rendering a period delta should render the cohort size beside it. */
  movement: CohortMovement | null;
  /** Cohort-matched per-dimension movement over the window (computeDimDeltas) — e.g. the Security
   * tab's "D9 vs 90d ago" tile delta. Null without a baseline (or no overlap). */
  dimDeltas: { dimId: string; delta: number }[] | null;
}

/** One repo's score snapshot on one side of the window — input to `computeWindowDeltas`. */
export interface RepoScoreSnap {
  repoId: string;
  overall: number;
  adoption: number;
  rigor: number;
}

/**
 * Cohort-matched period movement: the three deltas TOGETHER WITH the size of the cohort they were
 * measured over and the composition change that was excluded from them.
 *
 * A count travels with its predicate. "−4 points" over 4 matched repos out of 60 renders identically
 * to "−4 points" over 58 unless the cohort size ships with the number, so a reader cannot tell a
 * fleet trend from a rounding artifact on a tiny cohort. And the composition change the matching
 * correctly EXCLUDES is itself information ("5 repos onboarded this quarter") — reporting it beside
 * the delta is what makes the exclusion legible instead of silent.
 */
export interface CohortMovement {
  overall: number;
  adoption: number;
  rigor: number;
  /** Repos present on BOTH sides of the window — the denominator every delta above was measured over. */
  cohortSize: number;
  /** Repos scanned now with no baseline scan: onboarded (or first-scanned) inside the window. */
  onboarded: number;
  /** Repos in the baseline with no current scan: gone dark or removed inside the window. */
  departed: number;
}

/**
 * Cohort-matched period movement: measured ONLY over repos present on BOTH sides of the window.
 * Averaging the whole current fleet against the baseline cohort folds composition change into what is
 * presented as score movement — onboarding 5 low-scoring repos mid-quarter used to read as the fleet
 * "slipping" 25 points no repo experienced (and onboarding strong repos manufactured a fake climb),
 * while the movers panel below correctly showed zero regressions.
 *
 * Returns null when the cohorts don't overlap — there is no movement to qualify, and a 0-size cohort
 * reported as "0 repos, delta 0" would read as "no change" rather than "nothing measurable".
 */
export function computeCohortMovement(
  current: readonly RepoScoreSnap[],
  baseline: readonly RepoScoreSnap[],
): CohortMovement | null {
  const currentIds = new Set(current.map((c) => c.repoId));
  const before = baseline.filter((b) => currentIds.has(b.repoId));
  const beforeIds = new Set(before.map((b) => b.repoId));
  const now = current.filter((c) => beforeIds.has(c.repoId));
  if (!before.length || !now.length) return null;
  const avg = roundedMean;
  return {
    overall: avg(now.map((c) => c.overall)) - avg(before.map((b) => b.overall)),
    adoption: avg(now.map((c) => c.adoption)) - avg(before.map((b) => b.adoption)),
    rigor: avg(now.map((c) => c.rigor)) - avg(before.map((b) => b.rigor)),
    // The intersection is already computed above, so the qualifiers are free — the reason they were
    // missing was never cost. `now.length === before.length` by construction (both are the same repo
    // set, one snapshot each side), so either is the cohort size.
    cohortSize: now.length,
    onboarded: current.length - now.length,
    departed: baseline.length - before.length,
  };
}

/**
 * @deprecated The bare triple — movement with its denominator stripped off. Use
 * {@link computeCohortMovement} (same numbers, plus `cohortSize` / `onboarded` / `departed`) so the
 * count travels with the delta. Kept as a narrow projection while the callers that assert on the
 * exact three-key shape migrate.
 */
export function computeWindowDeltas(
  current: readonly RepoScoreSnap[],
  baseline: readonly RepoScoreSnap[],
): { overall: number; adoption: number; rigor: number } | null {
  const m = computeCohortMovement(current, baseline);
  return m && { overall: m.overall, adoption: m.adoption, rigor: m.rigor };
}

/** One repo's per-dimension scores on one side of the window — input to `computeDimDeltas`. */
export interface RepoDimSnap {
  repoId: string;
  dims: { dimId: string; score: number; signalScore?: number; llmScore?: number }[];
}

/**
 * Cohort-matched per-DIMENSION movement over the window — the same cohort semantics as
 * computeWindowDeltas (only repos present on both sides count), applied per dimId so a tab can show
 * "Security (D9) +6 vs 90d ago" without composition change bleeding into the number. Each side is
 * averaged over the matched repos that carry that dimension (an old scan predating a new dimension
 * simply doesn't vote); dimensions present on only one side are omitted. Null when cohorts don't overlap.
 */
export function computeDimDeltas(
  current: readonly RepoDimSnap[],
  baseline: readonly RepoDimSnap[],
): { dimId: string; delta: number }[] | null {
  const currentIds = new Set(current.map((c) => c.repoId));
  const before = baseline.filter((b) => currentIds.has(b.repoId));
  const beforeIds = new Set(before.map((b) => b.repoId));
  const now = current.filter((c) => beforeIds.has(c.repoId));
  if (!before.length || !now.length) return null;

  const avgByDim = (snaps: readonly RepoDimSnap[]) => {
    const acc: Record<string, { sum: number; n: number }> = {};
    for (const s of snaps)
      for (const d of s.dims) {
        const entry = (acc[d.dimId] = acc[d.dimId] || { sum: 0, n: 0 });
        entry.sum += d.score;
        entry.n += 1;
      }
    return acc;
  };
  const a = avgByDim(now);
  const b = avgByDim(before);
  return Object.keys(a)
    .filter((dimId) => b[dimId])
    .sort()
    .map((dimId) => ({
      dimId,
      delta: Math.round(a[dimId]!.sum / a[dimId]!.n) - Math.round(b[dimId]!.sum / b[dimId]!.n),
    }));
}

/**
 * The org maturity TREND buckets scans by LOCAL calendar day — the SAME zone the window boundaries use
 * (window.ts `startOfDay` snaps `start`/`end` to LOCAL midnight). Bucketing by `toISOString().slice(0,10)`
 * (a UTC day) meant a scan was FILTERED by one calendar and LABELLED by another whenever the server runs
 * off UTC: a late-evening local scan (e.g. 2026-05-01 01:00 local = 2026-04-30 23:00Z) landed in the
 * previous UTC day's bucket, splitting one local day across two trend points and skewing the
 * forecastTrajectory ETA. One zone shared with the window. Mirrors window.ts `toDayInput`. (fleet-rollups-insights #2)
 */
function localDayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export async function getOrgRollup(orgSlug: string, window?: OrgWindow, segmentId?: string | null, techGroupId?: string | null): Promise<OrgRollup | null> {
  if (!isDbConfigured()) return null;
  const prisma = getPrisma();
  // Needs the full org row (org.plan feeds the retention window for the trend floor below), so this
  // routes through the cached full-row resolver rather than getOrgId (which returns only the id).
  const org = await getOrgBySlug(orgSlug);
  if (!org) return null;

  const start = window?.start ?? null;
  // Half-open upper bound (`lt: endExclusive`, falling back to the legacy `lte: end`).
  const upper = upperBound(window);
  // Segment AND tech-group filters compose — both narrow the same repo set (Feature 3b).
  const seg = { ...segmentScope(segmentId), ...techGroupScope(techGroupId) };

  // EXPLICIT `select`, not `include`, at BOTH levels (fleet-rollups-insights: cardinality-and-cost).
  //
  // `include` ships every scalar of every row. That is ~36 Repository columns and ~39 Scan columns
  // while the mapper below reads 18 and 11 — and the nested `take: 1` does NOT bound the transfer:
  // the Prisma 6.19 client query compiler applies a nested take AFTER the fetch, so the emitted
  // `SELECT … FROM "Scan" WHERE "repoId" IN (…)` carries no LIMIT and the org's ENTIRE scan history
  // crosses the wire so one row per repo can be kept (measured and documented at length in
  // org-insights.ts' getOrgBacklog header). Every unread column is therefore paid for once per scan
  // ever taken, not once per repo — including the big JSON blobs (`strengths`, `risks`,
  // `discrepancies`, `aiUsageJson`, `warningsJson`, `scoreIntegrityJson`, `practiceShape`, and the
  // Scan-side techStack/passport/contextHealth/manifest/guidanceGraph duplicates the mapper reads off
  // REPOSITORY instead). Naming the columns is the whole fix; the shape the mapper sees is identical.
  //
  // Adding a field to OrgRepoRow means adding it HERE too — that is the intended friction.
  const repos = await prisma.repository.findMany({
    where: { orgId: org.id, ...seg, OR: [{ watched: true }, { scans: { some: {} } }] },
    select: {
      id: true,
      fullName: true,
      owner: true,
      name: true,
      isPrivate: true,
      watched: true,
      primaryLanguage: true,
      // The five cached-from-latest-scan blobs the row parsers read — all off Repository, so no scan
      // join is involved and the Scan-side copies of the same names are never fetched.
      techStackJson: true,
      passportJson: true,
      passportOverridesJson: true,
      contextHealthJson: true,
      manifestJson: true,
      guidanceGraphJson: true,
      scanSchedule: true,
      lastScanAt: true,
      lastScanStatus: true,
      lastScanError: true,
      aiConformance: true,
      scans: {
        // Bound the "current" snapshot to the window end (almost always now) so a custom range
        // that ends in the past reflects the fleet as it stood then.
        where: upper ? { scannedAt: upper } : undefined,
        orderBy: { scannedAt: "desc" },
        take: 1,
        select: {
          level: true,
          overallScore: true,
          adoptionScore: true,
          rigorScore: true,
          posture: true,
          scannedAt: true,
          engineProvider: true,
          governance: true,
          prStats: true,
          commitActivity: true,
          platformSignalsJson: true,
          // signalScore + llmScore ride along so a consumer can tell whether the guardband BOUND on a
          // dimension (|llm - signal| > band) — the one persisted trace of the model having disagreed
          // with a detector more strongly than the engine let it act on. Two ints per dimension row.
          dimensions: { select: { dimId: true, score: true, signalScore: true, llmScore: true } },
        },
      },
    },
    orderBy: { fullName: "asc" },
  });

  // Two-speed freshness (moonshot #10), two cheap fleet-wide reads rather than a per-row query:
  // the newest control observation per repo, and which repos have unsettled queue rows. Both degrade
  // to "nothing known" on failure — an empty map renders as "—", which is the honest answer, and is
  // also what an org that has never been probed genuinely looks like.
  const controlsByRepo = new Map<string, string>();
  const queuedRepos = new Set<string>();
  try {
    const grouped = await prisma.controlObservation.groupBy({
      by: ["repoFullName"],
      where: { orgId: org.id },
      _max: { observedAt: true },
    });
    for (const g of grouped) if (g._max.observedAt) controlsByRepo.set(g.repoFullName, g._max.observedAt.toISOString());
  } catch {
    // No observations table access / no rows — leave the map empty.
  }
  try {
    const pending = (await prisma.scanJob.findMany({
      where: { orgId: org.id, state: { in: ["queued", "claimed"] } },
      select: { repoFullName: true },
    })) as { repoFullName: string }[];
    for (const p of pending) queuedRepos.add(p.repoFullName);
  } catch {
    // Same: an unreadable queue means "we don't know of any queued work", not "there is none".
  }

  const rows: OrgRepoRow[] = repos.map((r) => {
    const s = r.scans[0];
    // Parse the persisted default-branch governance blob so the fleet gate can enforce
    // `requireProtectedBranch` (governance fleet view) with the same readable-gated semantics as the
    // CI gate — previously the rollup carried no protection data, so that bar was silently dead in
    // the dashboard while the copyable CI snippet enforced it (dashboard↔CI drift).
    const gov = parseGovernanceLite(s?.governance);
    // W2 provenance signal for the fleet gate — parsed from the SAME persisted prStats blob the
    // activity columns read, so it costs no extra query and no extra parse pass of its own.
    const prov = parseProvenanceLite(s?.prStats);
    return {
      fullName: r.fullName,
      owner: r.owner,
      name: r.name,
      isPrivate: r.isPrivate,
      watched: r.watched,
      primaryLanguage: r.primaryLanguage ?? null,
      techStack: parseTechStackJson(r.techStackJson),
      passport: (() => {
        const pp = parsePassportJson(r.passportJson);
        return pp ? applyPassportOverrides(pp, parsePassportOverrides(r.passportOverridesJson)) : null;
      })(),
      contextHealth: parseContextHealthJson(r.contextHealthJson),
      manifest: parseManifestReadoutJson(r.manifestJson),
      guidanceGraph: parseGuidanceGraphJson(r.guidanceGraphJson),
      freshness: {
        scoredAt: s ? s.scannedAt.toISOString() : (r.lastScanAt?.toISOString() ?? null),
        controlsAt: controlsByRepo.get(r.fullName) ?? null,
        queued: queuedRepos.has(r.fullName),
      },
      scanSchedule: r.scanSchedule,
      lastScanAt: r.lastScanAt ? r.lastScanAt.toISOString() : null,
      lastScanStatus: r.lastScanStatus,
      lastScanError: r.lastScanError,
      aiConformance: r.aiConformance ?? null,
      activity: parseRepoActivity(s?.commitActivity, s?.prStats),
      latest: s
        ? {
            level: s.level,
            overall: s.overallScore,
            adoption: s.adoptionScore,
            rigor: s.rigorScore,
            posture: s.posture,
            scannedAt: s.scannedAt.toISOString(),
            engine: s.engineProvider,
            dims: s.dimensions,
            unmeasurableDims: unmeasurablePlatformDims(parsePlatformSignals(s.platformSignalsJson)),
            // See `incomplete` on OrgRepoRow["latest"]: no dimension row means nothing was scored,
            // which is the same predicate the engine and the per-repo gate use.
            incomplete: s.dimensions.length === 0,
            govReadable: gov?.readable,
            protected: gov?.protected,
            aiGovernedRate: prov?.aiGovernedRate ?? null,
            aiPrSample: prov?.aiPrSample ?? null,
          }
        : null,
    };
  });

  const scanned = rows.filter((r) => r.latest);
  // The honest denominator for every AVERAGE below. `scanned` still counts the whole set — a count of
  // repos with a scan is a count, and stays one; only the figures presented as MEASUREMENTS narrow.
  const realScored = scanned.filter((r) => !isMockScore(r.latest!.engine));
  const mockCount = scanned.length - realScored.length;
  const avg = roundedMean;
  const postureCounts: Record<string, number> = {};
  for (const r of scanned) postureCounts[r.latest!.posture] = (postureCounts[r.latest!.posture] ?? 0) + 1;

  // Per-dimension fleet averages narrow to `realScored` for the SAME reason the three headline
  // averages do: a dimension average is presented as a measurement, and the mock floor was never
  // measured. Iterating `scanned` here meant the badge's overall excluded the placeholder while the
  // dimension bars drawn under it folded it in — two numbers on one card, disagreeing by the weight
  // of the floor. `realScoredCount` is the stated denominator for these too.
  const dimSum = new GroupedMean();
  for (const r of realScored) for (const d of r.latest!.dims) dimSum.add(d.dimId, d.score);
  const dimAverages = dimSum
    .keys()
    .sort()
    .map((dimId) => ({ dimId, avg: dimSum.get(dimId) }));

  // Org maturity trend: avg overall per day across scans within the window. The lower bound is also
  // clamped to the plan's retention window — a NON-DESTRUCTIVE read floor — so the trajectory looks back
  // only as far as the tier buys (Free 30d · Pro 180d · Team 365d · Enterprise unlimited). The current
  // fleet snapshot above is untouched: retention caps HISTORY depth, not today's number. (CRED retention.)
  const retentionStart = retentionCutoff(org.plan, Date.now());
  const trendStart = retentionStart && (!start || retentionStart > start) ? retentionStart : start;
  const allScans = await prisma.scan.findMany({
    where: {
      repo: { orgId: org.id, ...seg },
      ...dateRange(trendStart, window),
      // Mock placeholders are excluded from the LINE for the same reason they are excluded from the
      // badge drawn above it (see isMockScore). Without this the two disagreed structurally: the
      // headline average refused the deterministic floor while the trend it sits on folded it in, and
      // `forecastTrajectory` below then fit the promotion ETA over that mixed series — an ETA partly
      // extrapolated from scans that were never scored.
      engineProvider: { not: MOCK_ENGINE },
    },
    select: { scannedAt: true, overallScore: true },
    orderBy: { scannedAt: "asc" },
  });
  const byDay = new GroupedMean();
  // LOCAL calendar day (localDayKey) — the same zone the window snaps to — so different-cadence repos
  // bucket into the SAME day instead of splitting across a UTC midnight (bug+ui scan timezone fix).
  for (const s of allScans) byDay.add(localDayKey(s.scannedAt), s.overallScore);
  const trend = byDay
    .keys()
    .sort()
    .map((date) => ({ date, avg: byDay.get(date) }));

  // Project where the org maturity trend is heading from its per-day history.
  const forecast = forecastTrajectory(trend.map((t) => ({ date: t.date, value: t.avg })));

  // Averaged over the live-scored repos ONLY, matching the cohort card's `avgRealScore` — the two
  // headline numbers in the same scroll used to disagree by the whole weight of the mock floor, and
  // the badge was the one without a stated basis. `realScoredCount`/`mockCount` ride out with them so
  // the badge can say what it excluded.
  const avgOverall = avg(realScored.map((r) => r.latest!.overall));
  const avgAdoption = avg(realScored.map((r) => r.latest!.adoption));
  const avgRigor = avg(realScored.map((r) => r.latest!.rigor));

  // Baseline = the fleet as it stood at the window start: latest scan per repo at-or-before `start`.
  // Powers the per-tile period delta and the period-in-review banner. Deltas are cohort-matched
  // (computeWindowDeltas): the tiles keep the fleet-wide averages as their main values, but the
  // movement number compares only repos that exist on both sides of the window.
  let baseline: OrgRollup["baseline"] = null;
  let movement: OrgRollup["movement"] = null;
  let dimDeltas: OrgRollup["dimDeltas"] = null;
  if (start) {
    // The retention floor applies to the BASELINE too (fleet-rollups-insights #1): period-over-period
    // comparison is INSIDE the entitlement, same as the trend. Without this clamp a Free org (30d
    // retention) with a 90d/quarter window computed its headline deltas/dimDeltas against scans up to
    // arbitrarily old — history the same page's trend refuses to draw. Clamping `start` keeps both
    // surfaces coherent: the baseline is the fleet as of the oldest instant the tier buys.
    const effStart = retentionStart && retentionStart > start ? retentionStart : start;
    const priorScans = await prisma.scan.findMany({
      // Half-open window: the baseline is scans STRICTLY before `start`, while the in-window trend uses
      // `gte: start` (above). A scan whose timestamp is exactly `start` (e.g. seed/snapshot data at a
      // clean local midnight) previously counted as BOTH the baseline and the first in-window point —
      // comparing it against itself for a spurious 0-delta. `lt` makes each scan land on one side only.
      //
      // `distinct: ["repoId"]` bounds this to ONE row per repo AT THE DB (rows are scannedAt desc, so the
      // kept row is each repo's latest before `start`) — instead of pulling the org's ENTIRE pre-window
      // history into Node just to dedupe in a JS loop, which scaled with fleet AGE not the period (tens of
      // thousands of rows for an org scanned daily for a year+). Mirrors the fix getOrgMovers already
      // applies to its baseline query (org-insights.ts). (fleet-rollups-insights #1)
      where: { repo: { orgId: org.id, ...seg }, scannedAt: { lt: effStart } },
      // engineProvider rides along so a mock placeholder on the BASELINE side is excluded from the
      // period delta the same way it is on the current side — otherwise a mock→live re-scan would
      // still read as fleet movement on the badge while the cohort card correctly refuses it.
      select: { id: true, repoId: true, overallScore: true, adoptionScore: true, rigorScore: true, engineProvider: true },
      orderBy: { scannedAt: "desc" },
      distinct: ["repoId"],
    });
    // Defensive first-per-repo pick over the already-deduped rows, mirroring getOrgMovers: keeps the
    // baseline correct as one row per repo even if a driver ever under-honors `distinct`.
    const seen = new Set<string>();
    const deduped: typeof priorScans = [];
    for (const s of priorScans) {
      if (seen.has(s.repoId)) continue;
      seen.add(s.repoId);
      deduped.push(s);
    }
    // Mock placeholders drop out of the baseline cohort, exactly as they drop out of the current one
    // below. We do NOT reach further back for an older live scan in their place: that would move the
    // baseline INSTANT the `asOf` label claims, trading one silent inaccuracy for another.
    const latestPerRepo = deduped.filter((s) => !isMockScore(s.engineProvider));
    if (latestPerRepo.length) {
      baseline = {
        // asOf reflects the EFFECTIVE (retention-clamped) baseline instant, so a plan-limited
        // comparison is honestly labeled rather than claiming the full window depth.
        asOf: effStart.toISOString(),
        repos: latestPerRepo.length,
        avgOverall: avg(latestPerRepo.map((s) => s.overallScore)),
        avgAdoption: avg(latestPerRepo.map((s) => s.adoptionScore)),
        avgRigor: avg(latestPerRepo.map((s) => s.rigorScore)),
      };
      const currentSnaps: RepoScoreSnap[] = repos
        .filter((r) => r.scans[0] && !isMockScore(r.scans[0]!.engineProvider))
        .map((r) => ({
          repoId: r.id,
          overall: r.scans[0]!.overallScore,
          adoption: r.scans[0]!.adoptionScore,
          rigor: r.scans[0]!.rigorScore,
        }));
      movement = computeCohortMovement(
        currentSnaps,
        latestPerRepo.map((s) => ({ repoId: s.repoId, overall: s.overallScore, adoption: s.adoptionScore, rigor: s.rigorScore })),
      );
      // Per-dimension movement needs the baseline scans' dimension rows — fetched for ONLY the deduped
      // latest-per-repo scan ids (bounded at one scan per repo), not every prior scan in the org.
      const priorDims = await prisma.scanDimension.findMany({
        where: { scanId: { in: latestPerRepo.map((s) => s.id) } },
        select: { scanId: true, dimId: true, score: true },
      });
      const dimsByScan = new Map<string, { dimId: string; score: number }[]>();
      for (const d of priorDims) {
        const list = dimsByScan.get(d.scanId) ?? [];
        list.push({ dimId: d.dimId, score: d.score });
        dimsByScan.set(d.scanId, list);
      }
      dimDeltas = computeDimDeltas(
        repos
          .filter((r) => r.scans[0] && !isMockScore(r.scans[0]!.engineProvider))
          .map((r) => ({ repoId: r.id, dims: r.scans[0]!.dimensions })),
        latestPerRepo.map((s) => ({ repoId: s.repoId, dims: dimsByScan.get(s.id) ?? [] })),
      );
    }
  }

  return {
    org: orgSlug,
    repoCount: rows.length,
    scannedCount: scanned.length,
    avgOverall,
    avgAdoption,
    avgRigor,
    realScoredCount: realScored.length,
    mockCount,
    postureCounts,
    dimAverages,
    repos: rows,
    trend,
    forecast,
    baseline,
    // `deltas` is the deprecated narrow projection of the same value — one source, so the two can
    // never disagree while consumers migrate to `movement`.
    deltas: movement && { overall: movement.overall, adoption: movement.adoption, rigor: movement.rigor },
    movement,
    dimDeltas,
  };
}

/**
 * The rollup keyed on PRIMITIVES, so React's `cache()` can actually memoize it.
 *
 * `cache()` compares arguments by identity: two call sites passing `undefined` and `null` for the
 * same "no segment", or two structurally-equal `OrgWindow` objects, would each miss and run the whole
 * rollup again. Every optional is normalized to `null` and every Date to epoch-ms here, so any two
 * callers asking the same question in one request share one read.
 */
const getOrgRollupMemo = cache(
  async (
    orgSlug: string,
    startMs: number | null,
    endMs: number | null,
    endExclusiveMs: number | null,
    segmentId: string | null,
    techGroupId: string | null,
  ): Promise<OrgRollup | null> =>
    getOrgRollup(
      orgSlug,
      {
        start: startMs == null ? null : new Date(startMs),
        end: endMs == null ? null : new Date(endMs),
        endExclusive: endExclusiveMs == null ? null : new Date(endExclusiveMs),
      },
      segmentId,
      techGroupId,
    ),
);

/**
 * Request-scoped `getOrgRollup` — same signature, same result, but two panels on one page that ask
 * for the SAME scope pay for one read instead of two.
 *
 * The Repositories tab is why this exists: its leaderboard and its Context Health lens each ran their
 * own full rollup per render (and Context Health's was UNSCOPED, so it silently ignored the `?stack=`
 * filter its sibling honours — two panels on one screen describing different fleets). Prefer this over
 * `getOrgRollup` from any server component; the raw function stays exported for the API routes and
 * cron paths that run outside a React request, where `cache()` is a no-op anyway.
 */
export function getOrgRollupShared(
  orgSlug: string,
  window?: OrgWindow,
  segmentId?: string | null,
  techGroupId?: string | null,
): Promise<OrgRollup | null> {
  return getOrgRollupMemo(
    orgSlug,
    window?.start?.getTime() ?? null,
    window?.end?.getTime() ?? null,
    window?.endExclusive?.getTime() ?? null,
    segmentId ?? null,
    techGroupId ?? null,
  );
}

/** One repo's overall-score reading at a single historical scan — the atom of the fleet trajectory view. */
export interface RepoTrajectoryPoint {
  at: string; // ISO scannedAt
  overall: number;
  /** The two posture axes at this observation. Carried so a consumer can place the point in
   *  adoption × rigor space (the live tab's observatory trails) instead of back-deriving a position
   *  from `posture`, which would only ever yield a quadrant centroid the repo was never measured at. */
  adoption: number;
  rigor: number;
  level: string; // "L1".."L5"
  posture: string;
  headSha: string | null;
  /** Engine that produced this point — "mock" is the deterministic floor, else a live model. Lets the
   *  trend flag mock points and detect a mock→live transition (an engine change, not real movement). */
  engine: string;
}

/** A repo's full overall-score history across the window (oldest → newest). */
export interface OrgRepoHistory {
  fullName: string;
  owner: string;
  name: string;
  points: RepoTrajectoryPoint[];
}

/**
 * Per-repo overall-score history across the window — the data behind the Overview's repos×time view
 * (every repo's climb/decline across ITS OWN historical scans, which neither the fleet-aggregate
 * `trend` line nor the two-point `getOrgMovers` delta can express). One window-bounded query over the
 * org's scans, grouped by repo and sorted oldest→newest. The lower bound is retention-clamped exactly
 * like getOrgRollup's trend so per-repo history depth follows the plan tier (Free 30d · Pro 180d ·
 * Team 365d · Enterprise unlimited). Segment + tech-group scoped like the rest of the dashboard.
 * A repo with a single scan in the window yields a one-point series (the view degrades to "no trend
 * yet"); empty array when the DB is off or the org doesn't exist.
 */
export async function getOrgRepoHistories(
  orgSlug: string,
  window?: OrgWindow,
  segmentId?: string | null,
  techGroupId?: string | null,
): Promise<OrgRepoHistory[]> {
  if (!isDbConfigured()) return [];
  const prisma = getPrisma();
  const org = await getOrgBySlug(orgSlug);
  if (!org) return [];

  const start = window?.start ?? null;
  const seg = { ...segmentScope(segmentId), ...techGroupScope(techGroupId) };
  // Same retention floor as the trend: never look further back than the plan buys.
  const retentionStart = retentionCutoff(org.plan, Date.now());
  const lower = retentionStart && (!start || retentionStart > start) ? retentionStart : start;

  const scans = await prisma.scan.findMany({
    where: {
      repo: { orgId: org.id, ...seg },
      ...dateRange(lower, window),
    },
    select: {
      overallScore: true,
      adoptionScore: true,
      rigorScore: true,
      level: true,
      posture: true,
      headSha: true,
      scannedAt: true,
      engineProvider: true,
      repo: { select: { fullName: true, owner: true, name: true } },
    },
    orderBy: { scannedAt: "asc" },
  });

  const byRepo = new Map<string, OrgRepoHistory>();
  for (const s of scans) {
    let h = byRepo.get(s.repo.fullName);
    if (!h) {
      h = { fullName: s.repo.fullName, owner: s.repo.owner, name: s.repo.name, points: [] };
      byRepo.set(s.repo.fullName, h);
    }
    // Rows arrive scannedAt-asc, so each repo's points accumulate oldest→newest without re-sorting.
    h.points.push({
      at: s.scannedAt.toISOString(),
      overall: s.overallScore,
      adoption: s.adoptionScore,
      rigor: s.rigorScore,
      level: s.level,
      posture: s.posture,
      headSha: s.headSha ?? null,
      engine: s.engineProvider,
    });
  }
  // Stable base order (longest history first, then name) so SSR and client hydration agree before the
  // view applies its own sort.
  return [...byRepo.values()].sort((a, b) => b.points.length - a.points.length || a.fullName.localeCompare(b.fullName));
}

/** A lightweight org header summary — repo/scan/watch counts + avg maturity. The org shell wraps EVERY
 *  tab but consumes only these four fields (header chip + the has-data guard), so running the full
 *  getOrgRollup there (all repos + latest scans + per-dim rows + governance/passport parsing, then
 *  trend/forecast/deltas) inflated TTFB on every dashboard view to throw most of it away. This mirrors
 *  the rollup's repo set (watched OR has-scans) and avg-of-latest-overall math, but as one cheap query.
 *
 *  It also backs the Overview's `generateMetadata`, which needs only avgOverall/scannedCount/repoCount
 *  for the unfurl description: that call site used to run its OWN unscoped getOrgRollup, so the Overview
 *  paid for TWO full rollups per render (metadata + the page's scoped one) even after the shell was
 *  moved onto this summary. Both extra rollups are gone; the page keeps exactly one, scoped.
 *
 *  …and it backs the co-located `opengraph-image.tsx`, which was the SAME defect one file over: the OG
 *  card ran a full unscoped rollup per crawler fetch to print five scalars. It needed three fields this
 *  summary didn't carry (avgAdoption, avgRigor, postureCounts), so those were added HERE rather than
 *  forked into a second parallel summary query — they're the same latest-scan-per-repo pass the summary
 *  already does, three more columns on a select it already runs, no extra round-trip. Every derivation
 *  below mirrors getOrgRollup's exactly (same repo set, same `roundedMean` over latest scores, same
 *  posture tally over scanned repos) so the two can never disagree on a shared number. */
export interface OrgHeaderSummary {
  repoCount: number;
  scannedCount: number;
  watchedCount: number;
  avgOverall: number;
  /** Mean of each scanned repo's latest adoption score — mirrors `getOrgRollup.avgAdoption`. */
  avgAdoption: number;
  /** Mean of each scanned repo's latest rigor score — mirrors `getOrgRollup.avgRigor`. */
  avgRigor: number;
  /** Scanned repos per posture id — mirrors `getOrgRollup.postureCounts`. */
  postureCounts: Record<string, number>;
  /**
   * Scanned repos per maturity level id ("L1".."L5"), from each repo's latest overall score (W1c).
   * Folded in the SAME pass as postureCounts over rows this query already fetched, so it costs no
   * extra query — which is what lets the shell's programme strip answer "N of M repos at target"
   * without buying the full getOrgRollup (see "Shell cost discipline" in the org-intelligence doc).
   */
  levelCounts: Record<string, number>;
  /** Tenant flavor — "personal" swaps the shell to the individual-workspace nav subset. */
  kind: "org" | "personal";
  /** Repos whose latest scan was LIVE-scored — the denominator of the three averages above, mirroring
   *  `getOrgRollup.realScoredCount`. 0 means the averages are undefined and must render as "—". */
  realScoredCount: number;
  /** Repos whose latest scan is a mock placeholder, excluded from the averages (mirrors the rollup). */
  mockCount: number;
}

// React-`cache()`d (request-scoped memo, the repo's convention for shell+page shared reads — see
// getOrgFindings in lib/org/nav-counts.ts): the layout runs this for EVERY org tab's shell, and any
// page that branches on personal-vs-org kind calls it again in the SAME request. Without the memo
// each call was its own DB round-trip on a force-dynamic route — the "the layout already ran this"
// comments at those call sites were aspiration, not fact.
export const getOrgHeaderSummary = cache(async (orgSlug: string): Promise<OrgHeaderSummary | null> => {
  if (!isDbConfigured()) return null;
  const prisma = getPrisma();
  const org = await prisma.organization.findUnique({ where: { slug: normalizeOrgSlug(orgSlug) }, select: { id: true, kind: true } });
  if (!org) return null;
  const repos = await prisma.repository.findMany({
    where: { orgId: org.id, OR: [{ watched: true }, { scans: { some: {} } }] },
    select: {
      watched: true,
      scans: {
        orderBy: { scannedAt: "desc" },
        take: 1,
        select: { overallScore: true, adoptionScore: true, rigorScore: true, posture: true, engineProvider: true },
      },
    },
  });
  // One pass over the same latest-scan-per-repo rows the counts already need. `scanned` is the rollup's
  // definition of the word: a repo with at least one scan (an unscanned watched repo contributes to
  // repoCount and nothing else).
  const scanned = repos.map((r) => r.scans[0]).filter((s): s is NonNullable<typeof s> => s != null);
  const postureCounts: Record<string, number> = {};
  const levelCounts: Record<string, number> = {};
  for (const s of scanned) {
    postureCounts[s.posture] = (postureCounts[s.posture] ?? 0) + 1;
    const lvl = levelForScore(s.overallScore).id;
    levelCounts[lvl] = (levelCounts[lvl] ?? 0) + 1;
  }
  // The averages exclude mock placeholders exactly as getOrgRollup does (its docstring promises the
  // two "can never disagree"; until 2026-09-05 the rollup narrowed and this one did not, so the shell
  // chip and the Overview badge on the SAME page could show two different fleet averages). Counts stay
  // counts over every scanned repo.
  const realScored = scanned.filter((s) => !isMockScore(s.engineProvider));
  return {
    repoCount: repos.length,
    scannedCount: scanned.length,
    watchedCount: repos.filter((r) => r.watched).length,
    avgOverall: roundedMean(realScored.map((s) => s.overallScore)),
    avgAdoption: roundedMean(realScored.map((s) => s.adoptionScore)),
    avgRigor: roundedMean(realScored.map((s) => s.rigorScore)),
    postureCounts,
    levelCounts,
    kind: org.kind === "personal" ? "personal" : "org",
    realScoredCount: realScored.length,
    mockCount: scanned.length - realScored.length,
  };
});

/** One inference engine's share of an org's scans over a window. */
export interface EngineMixEntry {
  provider: string;
  count: number;
}

/**
 * Count the org's scans by inference engine over the window — the provenance behind the period's
 * scores. Surfacing it on the durable briefing makes a mock-degraded quarter (a live model that fell
 * back to the deterministic mock) auditable, not just visible in the transient scan stream (DIANE).
 * Sorted by count desc; empty when the DB is off or the org has no scans.
 */
export async function getOrgEngineMix(orgSlug: string, window?: OrgWindow, segmentId?: string | null, techGroupId?: string | null): Promise<EngineMixEntry[]> {
  if (!isDbConfigured()) return [];
  const prisma = getPrisma();
  // The full org row, not just the id: `org.plan` feeds the retention floor below.
  const org = await getOrgBySlug(orgSlug);
  if (!org) return [];
  // Retention clamp — the SAME non-destructive read floor every other windowed reader applies (the
  // rollup's trend, its baseline, getOrgMovers, getOrgTeamRollup). This was the one windowed reader
  // without it, so an "engine mix for the quarter" on a Free org (30d retention) counted scans from
  // history the same page's trend refuses to draw: the provenance panel and the trend it explains
  // were reading different amounts of the past.
  const retentionStart = retentionCutoff(org.plan, Date.now());
  const rawStart = window?.start ?? null;
  const start = retentionStart && (!rawStart || retentionStart > rawStart) ? retentionStart : rawStart;
  const groups = await prisma.scan.groupBy({
    by: ["engineProvider"],
    where: {
      repo: { orgId: org.id, ...segmentScope(segmentId), ...techGroupScope(techGroupId) },
      ...dateRange(start, window),
    },
    _count: true,
  });
  return groups
    .map((g) => ({ provider: g.engineProvider, count: g._count as number }))
    // Stable tiebreak on provider so two engines with the same count render in a deterministic order
    // instead of the DB's arbitrary groupBy order (fleet-rollups-insights #6).
    .sort((a, b) => b.count - a.count || a.provider.localeCompare(b.provider));
}

/** How many recommendations the org ACTIONED in the window — engagement (any status change) and
 *  completion (→ done). With the rollup's points-moved + level promotions this answers the renewal
 *  question "did anyone act on this, and did it move the number?" (TANIA). Counts RecommendationEvent
 *  status changes joined org → repo → scan → recommendation; segment-scoped like the rest. */
export async function getOrgRecsActioned(
  orgSlug: string,
  window?: OrgWindow,
  segmentId?: string | null,
  techGroupId?: string | null,
): Promise<{ engaged: number; actioned: number }> {
  if (!isDbConfigured()) return { engaged: 0, actioned: 0 };
  const prisma = getPrisma();
  const orgId = await getOrgId(orgSlug);
  if (!orgId) return { engaged: 0, actioned: 0 };
  const start = window?.start ?? null;
  const scope = {
    kind: "status",
    ...dateRange(start, window, "createdAt"),
    recommendation: { scan: { repo: { orgId, ...segmentScope(segmentId), ...techGroupScope(techGroupId) } } },
  };
  const [engaged, actioned] = await Promise.all([
    prisma.recommendationEvent.count({ where: scope }),
    prisma.recommendationEvent.count({ where: { ...scope, toValue: "done" } }),
  ]);
  return { engaged, actioned };
}
