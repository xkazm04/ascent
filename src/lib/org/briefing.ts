// Executive briefing — assembles the existing org aggregates (maturity rollup, corpus benchmark,
// movers, goals, forecast) into one exec-grade narrative, plus a markdown serializer that doubles as
// the "Copy for LLM" payload (paste into Claude Code / an LLM to get next actions). Pure assembly over
// @/lib/db; no new queries. Powers /org/[slug]/executive and (Phase 5.2) the scheduled PDF digest.

import {
  getOrgBenchmark,
  getOrgMovers,
  getOrgRecommendations,
  getOrgRollup,
  listGoals,
  type OrgRec,
  type OrgWindow,
  type RepoMove,
  type GoalPctBasis,
} from "@/lib/db";
import { getOrgEngineMix, getOrgRecsActioned, type EngineMixEntry } from "@/lib/db/org";
import { hasFleetGrade } from "@/lib/db/org-shared";
import { getOrgPractices, getPlaybookAdoption, listPlaybooks } from "@/lib/db";
import { buildPracticeLibrarySummary } from "@/lib/org/practice-library";
import { getImprovementEvents, type ImprovementEvent } from "@/lib/db/improvement-events";
import { MOCK_ENGINE } from "@/lib/maturity/attribution";
import { composeGoal, composeTrajectory, forecastConfidenceNote } from "@/lib/maturity/forecast";
import { DIMENSION_BY_ID, levelForScore } from "@/lib/maturity/model";
import type { DimensionId } from "@/lib/types";

/** "trend confidence 30% · noisy" — the same hedge the exec page shows under the trajectory headline,
 *  so the board PDF and the shared read-only link can't present a low-R² projection as a firm headline.
 *  Re-exported from @/lib/maturity/forecast, where it now lives beside the composer that uses it, so
 *  the phrase has exactly one definition; this alias keeps every existing import site unchanged. */
export { forecastConfidenceNote };

export interface BriefingDim {
  dimId: string;
  label: string;
  avg: number;
}
export interface BriefingMove {
  name: string;
  /** owner/name, so the exec page can link the row to the repo's report permalink. Optional — older
   *  fixtures/serialized briefings without it degrade to a static row, never a dead link. */
  fullName?: string;
  dOverall: number;
  levelFrom: string;
  levelTo: string;
}
export interface BriefingGoal {
  label: string;
  current: number;
  target: number;
  /** The meter, 0..100. `pctBasis` says WHICH QUESTION it answers and must travel with it:
   *  a goal created before baselines were stored can only report attainment (current/target),
   *  which opens near-full, while a goal with a baseline reports progress since it was set.
   *  Rendering the two side by side unlabelled invites a reader to compare them. */
  pct: number;
  pctBasis: GoalPctBasis;
  pctLabel: string;
  pace: string;
  etaDays: number | null;
  /** Composed goal read ({@link composeGoal}). Optional for fixture compatibility; `buildExecBriefing`
   *  always sets them. `headline`/`confidence`/`basis` are non-null together when projecting;
   *  `insufficiency` is the unmeasurable hedge and is the only thing a renderer may say about a
   *  sub-gate fit. Read them through `briefingGoal(g)` / `briefingGoalLine(g)`. */
  headline?: string | null;
  confidence?: number | null;
  basis?: string | null;
  insufficiency?: string | null;
}

export interface ExecBriefing {
  org: string;
  periodTitle: string;
  generatedOn: string; // YYYY-MM-DD
  maturity: { overall: number; levelId: string; levelName: string; adoption: number; rigor: number };
  /** How much of the fleet was LOOKED AT — `scanned` of `total` repositories. Deliberately NOT the
   *  basis of `maturity`: see {@link ExecBriefing.realScoredCount}. Read it through
   *  {@link coverageLine}. */
  coverage: { scanned: number; total: number };
  /** The DENOMINATOR of every figure in `maturity` (and of `periodDelta` / `valueRealized.pointsMoved`,
   *  which are differences of those means): scanned repos carrying a real graded score, mock
   *  placeholders excluded, straight off `getOrgRollup.realScoredCount`.
   *
   *  0 means the three averages are a division guard and NOT a grade — every renderer must land on
   *  its no-score path ({@link briefingHasScore} / {@link noScoreLine}). Required, not optional: a
   *  briefing that cannot say what its average is averaged over is the defect this field exists to
   *  remove, so it may not be silently absent. */
  realScoredCount: number;
  /** Scanned repos whose latest score is the deterministic mock floor — excluded from every average
   *  above, and therefore owed a disclosure wherever those averages are printed ({@link mockDisclosure}).
   *  `realScoredCount + mockCount === coverage.scanned`. */
  mockCount: number;
  /** Overall-score delta vs the window's start, or null for all-time / no baseline. */
  periodDelta: number | null;
  /** End-state comparison against the immediately-preceding equal-length window (EXEC-4); null for
   *  all-time or when the prior window has no scans. Whole-fleet (not cohort-matched) — a "vs previous
   *  period" read across headline + dimensions. */
  priorPeriod: {
    overall: number;
    adoption: number;
    rigor: number;
    dOverall: number;
    dAdoption: number;
    dRigor: number;
    /** The prior window's own live-scored denominator — the basis of `overall`/`adoption`/`rigor`
     *  above and therefore of every delta beside them. Non-zero by construction: the block is null
     *  when the prior window scored nothing live, because a delta against a division guard is a
     *  fabricated movement, not a comparison. */
    realScoredCount: number;
    /** Per-dimension now/prior/delta, biggest movers first (capped). */
    dims: { dimId: string; label: string; now: number; prior: number; delta: number }[];
  } | null;
  /** The projected trajectory sentence — set ONLY when the fit cleared the shared presentability gate
   *  (`isProjectable`). Null both when there is no fit at all and when the fit is real but too thin to
   *  present; `forecastInsufficiency` distinguishes those two. Never a bare slope off two scan days. */
  forecastHeadline: string | null;
  /** Trend confidence (R² as 0–100) behind the forecast headline; null when there's too little history.
   *  Carried so the executive read shows the same "· noisy" honesty the overview Trajectory card does.
   *  Non-null exactly when `forecastHeadline` is — the gate excludes `lowData`, where R² is 1 by
   *  construction, so the hedge can no longer go missing on the fits that most need it. */
  forecastConfidence: number | null;
  /** What the projection stands on — "fit over 9 scan days across 84 days[, 3 of them compacted]".
   *  Non-null exactly when `forecastHeadline` is. The answer to the only question the audit committee
   *  asks about a projection ("based on what?"), which the board artifacts previously could not give.
   *  OPTIONAL for the same fixture-compatibility reason as `recommendations`; `buildExecBriefing`
   *  always sets it. Read it through `briefingTrajectory(b)` / `briefingTrajectoryNote(b)`. */
  forecastBasis?: string | null;
  /** Why we are NOT projecting, in the same words the Delivery fit readout and the /trends panel use
   *  ("Not enough history to project: 2 distinct scan days…"). Set when a fit exists but falls below
   *  the shared gate; null when projecting, and null when there is no fit at all — nothing to refuse.
   *  OPTIONAL for fixture compatibility; `buildExecBriefing` always sets it. */
  forecastInsufficiency?: string | null;
  /** Which inference engine(s) produced this period's scores — provenance so a mock-degraded quarter
   *  is auditable in the durable briefing, not just the transient scan stream. */
  engineMix: EngineMixEntry[];
  /** Fleet adoption rate (0..100) — share of LIVE-SCORED repos at a HIGH-adoption posture (AI-Native
   *  or Fast & Ungoverned). Same denominator as {@link ExecBriefing.maturity} / `realScoredCount`;
   *  mock placeholders are not a posture measurement. Null when nothing is live-scored. */
  adoptionRate: number | null;
  /** Full-fleet movement scale this period (not just the top-3 listed) — how many comparable repos moved
   *  up vs down, so a 200-repo fleet sees the spread, not a capped list. */
  movement: { up: number; down: number; compared: number };
  /** Value realized THIS period — the renewal-justification: recs acted on, points moved, repos
   *  promoted. Answers "did anyone use it, and did it move the number?" rather than leaving a renewer
   *  to reconstruct it. */
  valueRealized: {
    /** Recommendations with any status change in the window (engagement). */
    recsEngaged: number;
    /** Recommendations moved to "done" in the window (completion). */
    recsActioned: number;
    /** Overall fleet points moved vs the period baseline; null on the all-time window. */
    pointsMoved: number | null;
    /** Repos that crossed up a maturity level in the window. */
    reposPromoted: number;
  };
  benchmark: {
    percentile: number | null;
    corpusRepos: number;
    corpusAvgOverall: number;
    /** Same-language peer cohort (sharper than the whole corpus); null when too few peers. */
    cohort: { language: string; repos: number; overallPercentile: number | null; adoptionPercentile: number | null } | null;
  } | null;
  strengths: BriefingDim[];
  risks: BriefingDim[];
  security: BriefingDim | null;
  topGainers: BriefingMove[];
  topRegressions: BriefingMove[];
  goals: BriefingGoal[];
  regressionCount: number;
  /** THE ONE RANKED SOURCE for "what to do next" (G5-02). The same top-N `getOrgRecommendations`
   *  list the exec page renders through `OrgLeverageMoves`, carried on the briefing so the screen,
   *  the board PDF and the "Copy for LLM" markdown all name the SAME move. It replaced a
   *  `risks[0] ?? security` heuristic that lived only in the export path and could label a dimension
   *  the fleet's *strongest* as "the fleet's weakest dimension" on a small, high-scoring fleet.
   *  Empty when the DB is unavailable or nothing qualifies — consumers OMIT the section rather than
   *  falling back to a second, divergent notion of "weakest".
   *
   *  OPTIONAL only so fixtures and previously-serialized briefings that predate the field still type
   *  (the `BriefingMove.fullName` precedent). `buildExecBriefing` ALWAYS sets it; read it through
   *  `briefingNextMove(b)` rather than indexing it directly. */
  recommendations?: OrgRec[];
  /** Practice-rollout PROOF — the "did the transformation work" numbers (starter PRs opened/merged
   *  from the Practice Library and the measured post-merge dimension lift). This is the only place
   *  the product PROVES improvement rather than reporting standing, so it belongs in front of the
   *  audience that funds the work — previously it was page-local to the Practices tab. Always
   *  FLEET-WIDE: practices are not segment-scoped, so a segment-scoped briefing still reports the
   *  whole library's rollout (renderers say so). Null when no practice was ever applied — "never
   *  tried" must not render as "tried and nothing landed". OPTIONAL for the same
   *  fixture-compatibility reason as `recommendations`; `buildExecBriefing` always sets it. */
  proof?: { open: number; merged: number; lift: number | null; liftPractices: number } | null;
  /**
   * MOONSHOT #26 — the LOOP's half of the proof block. Null on managed cloud (no lanes exist there)
   * and null when no lane has both scan ends, so the line is ABSENT rather than printed as "0 · 0".
   * `points` is branch-basis: verified movement on lane branches that have not merged. It is
   * deliberately reported separately from the practice proof, because "we merged it" and "it is
   * sitting on a branch waiting for review" are different claims to make to a board.
   */
  loopProof?: { lanes: number; points: number | null; merged: number } | null;
  /** Optional LLM-written executive narrative (G5-03). NEVER produced by `buildExecBriefing` — a
   *  deliverable path opts in explicitly via `attachBriefingNarrative` (see ./briefing-narrative),
   *  which is grounded strictly in the figures above and degrades to deterministic copy. Null/absent
   *  means "not requested", which every renderer must treat as "render no narrative". */
  narrative?: string | null;
}

const HIGH_ADOPTION_POSTURE = new Set(["ai-native", "ungoverned"]);

/**
 * Fleet adoption as a measurement: share of LIVE-SCORED repos at a high-adoption posture
 * (AI-Native or Fast & Ungoverned), 0..100. Null when nothing is live-scored.
 *
 * Direction 1. The briefing's other measurements already stand on `realScoredCount`. This used to
 * divide by `scannedCount`, so a mixed fleet's "is the standardization landing" number included mock
 * placeholders the rest of the briefing had excluded — overstating the denominator by exactly
 * `mockCount`. When repo rows are present, mock engines are excluded from the numerator too
 * (`postureCounts` is still the scanned-set histogram).
 */
export function fleetAdoptionRate(input: {
  realScoredCount: number;
  postureCounts: Record<string, number>;
  repos?: ReadonlyArray<{ latest: { engine?: string | null; posture: string } | null }>;
}): number | null {
  if (input.realScoredCount <= 0) return null;
  const live = (input.repos ?? []).filter((r) => r.latest != null && r.latest.engine !== MOCK_ENGINE);
  const denom = live.length > 0 ? live.length : input.realScoredCount;
  const high =
    live.length > 0
      ? live.filter((r) => HIGH_ADOPTION_POSTURE.has(r.latest!.posture)).length
      : (input.postureCounts["ai-native"] ?? 0) + (input.postureCounts["ungoverned"] ?? 0);
  return Math.round((high / denom) * 100);
}

const named = (d: { dimId: string; avg: number }): BriefingDim => ({
  dimId: d.dimId,
  label: DIMENSION_BY_ID[d.dimId as DimensionId]?.name ?? d.dimId,
  avg: d.avg,
});
const moveRow = (m: RepoMove): BriefingMove => ({
  name: m.name,
  fullName: m.fullName,
  dOverall: m.dOverall,
  levelFrom: m.levelFrom,
  levelTo: m.levelTo,
});

/** Assemble the briefing for an org over an optional window. Null when nothing has been scanned. */
export async function buildExecBriefing(
  orgSlug: string,
  window?: OrgWindow,
  periodTitle = "all time",
  segmentId?: string | null,
  techGroupId?: string | null,
): Promise<ExecBriefing | null> {
  // EXEC-4: the immediately-preceding equal-length window — its END state is the start of this one,
  // so current-minus-prior reads as movement across the period (per dimension + headline). Only when
  // the window has a start (all-time has no "previous period").
  //
  // The two windows ABUT, so this is the one place the half-open policy is load-bearing rather than
  // cosmetic: the prior period's upper bound is `endExclusive: window.start`, the exact instant the
  // current period's `gte: start` claims. With the old inclusive `end: window.start` a scan landing
  // precisely on the boundary was counted on BOTH sides — as the prior period's end state AND as the
  // current fleet — so the reported movement across the boundary was measured against itself (delta 0
  // where there was real movement). `[start, endExclusive)` partitions cleanly.
  const priorWindow: OrgWindow | undefined = window?.start
    ? {
        start: new Date(
          window.start.getTime() - ((window.endExclusive ?? window.end ?? new Date()).getTime() - window.start.getTime()),
        ),
        endExclusive: window.start,
      }
    : undefined;

  const [rollup, benchmark, movers, goals, priorRollup, engineMix, recsActivity, orgRecs, practices, playbooks, playbookAdoption, loopEvents] = await Promise.all([
    getOrgRollup(orgSlug, window, segmentId, techGroupId),
    getOrgBenchmark(orgSlug),
    getOrgMovers(orgSlug, window, segmentId, techGroupId),
    listGoals(orgSlug),
    priorWindow ? getOrgRollup(orgSlug, priorWindow, segmentId, techGroupId) : Promise.resolve(null),
    getOrgEngineMix(orgSlug, window, segmentId, techGroupId),
    getOrgRecsActioned(orgSlug, window, segmentId, techGroupId),
    // G5-02: the ranked next-move source moves ONTO the briefing so every renderer reads it from
    // here. Same args the exec page used when it queried this itself (top-5, same segment/stack
    // scope). `.catch(() => null)` mirrors that page: a recommendations failure must degrade the
    // section, never 500 the whole briefing/PDF.
    getOrgRecommendations(orgSlug, 5, segmentId, techGroupId).catch(() => null),
    // The proof block's inputs — the same three reads the Practices tab makes, folded through
    // buildPracticeLibrarySummary. NOT segment-scoped (practices aren't); techGroupId matches the
    // practices surface's own scoping. Each degrades independently — a practices failure must cost
    // the proof section, never the briefing/PDF.
    getOrgPractices(orgSlug, null, techGroupId).catch(() => null),
    listPlaybooks(orgSlug).catch(() => null),
    getPlaybookAdoption(orgSlug).catch(() => ({})),
    // The union read (moonshot #26). Degrades to [] independently, exactly like the practice reads
    // above: a loop failure costs the loop line, never the briefing or the PDF.
    getImprovementEvents(orgSlug, {
      start: window?.start ?? null,
      end: window?.endExclusive ?? window?.end ?? null,
    }).catch(() => [] as ImprovementEvent[]),
  ]);
  // `hasFleetGrade`, not `scannedCount === 0`: the briefing's whole maturity block is the three
  // averages, and a scanned-but-all-mock fleet has none of them. The old guard printed a board PDF
  // headlining 0/100 at L1.
  if (!rollup || !hasFleetGrade(rollup)) return null;

  const level = levelForScore(rollup.avgOverall);
  const dimSorted = [...rollup.dimAverages].sort((a, b) => b.avg - a.avg);
  const security = rollup.dimAverages.find((d) => d.dimId === "D9");

  // Strengths = top dims; risks = bottom dims. On a sparse fleet (<6 distinct dims) slice(0,3) and
  // slice(-3) would overlap, listing the same dim as both a top strength AND a top risk. Keep the two
  // lists DISJOINT by excluding any strength from the risk pool (rich-fleet behavior is unchanged —
  // there they were already disjoint). Ordering preserved: strengths strongest-first, risks weakest-first.
  // Cap strengths so they can't claim the dims that should be risks on a sparse fleet: at most the top
  // half (rounded up), capped at 3. On a rich fleet (≥6 dims) this stays the top 3 — unchanged — but on
  // e.g. a 3-dim fleet it's the top 2, so an obviously-weak dim (D9@30) is no longer bucketed as a
  // "strength" while ALSO surfacing as the weakness (executive-briefing #4). Risks remain the bottom of
  // the non-strength pool, so the two lists stay disjoint.
  const strengthCount = Math.min(3, Math.ceil(dimSorted.length / 2));
  const strengthDims = dimSorted.slice(0, strengthCount);
  const strengthIds = new Set(strengthDims.map((d) => d.dimId));
  const riskDims = dimSorted
    .filter((d) => !strengthIds.has(d.dimId))
    .slice(-3)
    .reverse();

  const priorPeriod =
    // Direction 1 — the prior window needs a GRADE, not merely a scan. An all-mock prior window used
    // to arrive with `avgOverall === 0` by division guard, and subtracting that from a real current
    // average manufactured a "+62 this period" the fleet never moved. That was guarded here by
    // re-deriving the condition from `realScoredCount`; `hasFleetGrade` is the same condition read off
    // the fields it actually governs, and it narrows all three for the subtractions below.
    priorRollup && hasFleetGrade(priorRollup)
      ? (() => {
          const priorBy = new Map(priorRollup.dimAverages.map((d) => [d.dimId, d.avg]));
          return {
            overall: priorRollup.avgOverall,
            adoption: priorRollup.avgAdoption,
            rigor: priorRollup.avgRigor,
            dOverall: rollup.avgOverall - priorRollup.avgOverall,
            dAdoption: rollup.avgAdoption - priorRollup.avgAdoption,
            dRigor: rollup.avgRigor - priorRollup.avgRigor,
            realScoredCount: priorRollup.realScoredCount,
            dims: rollup.dimAverages
              .map((d) => ({
                dimId: d.dimId,
                label: DIMENSION_BY_ID[d.dimId as DimensionId]?.name ?? d.dimId,
                now: d.avg,
                prior: priorBy.get(d.dimId) ?? 0,
                delta: d.avg - (priorBy.get(d.dimId) ?? 0),
              }))
              .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
              .slice(0, 6),
          };
        })()
      : null;

  return {
    org: orgSlug,
    periodTitle,
    generatedOn: new Date().toISOString().slice(0, 10),
    maturity: {
      overall: rollup.avgOverall,
      levelId: level.id,
      levelName: level.name,
      adoption: rollup.avgAdoption,
      rigor: rollup.avgRigor,
    },
    coverage: { scanned: rollup.scannedCount, total: rollup.repoCount },
    // Direction 1 — the rollup's own denominator travels ONTO the briefing, so every renderer can
    // answer "over what?" without reaching back to the db layer, and so a 0 denominator is visible
    // rather than inferred from a suspiciously round 0/100.
    realScoredCount: rollup.realScoredCount,
    mockCount: rollup.mockCount,
    periodDelta: rollup.baseline ? rollup.avgOverall - rollup.baseline.avgOverall : null,
    priorPeriod,
    // ONE composition, shared with /trends and Delivery: the presentability gate decides whether this
    // briefing may state a trajectory at all, and when it may, the hedge travels WITH the claim.
    // The old code suppressed the confidence figure on `lowData` and left the headline standing — so
    // the board PDF printed "Climbing at +35/wk" off two scan days with no caveat at all, while
    // Delivery refused the same claim one click away. Replacing the hedge, not deleting it. (MC-B1.)
    ...(() => {
      const t = composeTrajectory(rollup.forecast);
      return {
        forecastHeadline: t.headline,
        forecastConfidence: t.confidence,
        forecastBasis: t.basis,
        forecastInsufficiency: t.insufficiency,
      };
    })(),
    engineMix,
    adoptionRate: fleetAdoptionRate(rollup),
    movement: {
      up: movers?.gainers.length ?? 0,
      down: movers?.regressers.length ?? 0,
      compared: movers?.comparedRepos ?? 0,
    },
    valueRealized: {
      recsEngaged: recsActivity.engaged,
      recsActioned: recsActivity.actioned,
      pointsMoved: rollup.baseline ? rollup.avgOverall - rollup.baseline.avgOverall : null,
      reposPromoted: movers?.levelChanges?.filter((m) => m.levelDelta > 0).length ?? 0,
    },
    benchmark: benchmark
      ? {
          percentile: benchmark.overallPercentile,
          corpusRepos: benchmark.corpusRepos,
          corpusAvgOverall: benchmark.corpusAvgOverall,
          cohort: benchmark.cohort
            ? {
                language: benchmark.cohort.language,
                repos: benchmark.cohort.repos,
                overallPercentile: benchmark.cohort.overallPercentile,
                adoptionPercentile: benchmark.cohort.adoptionPercentile,
              }
            : null,
        }
      : null,
    strengths: strengthDims.map(named),
    risks: riskDims.map(named),
    security: security ? named(security) : null,
    topGainers: (movers?.gainers ?? []).slice(0, 3).map(moveRow),
    topRegressions: (movers?.regressers ?? []).slice(0, 3).map(moveRow),
    goals: (goals ?? []).map((g) => {
      // ONE composition, shared with the GoalCard readout: the presentability gate decides whether
      // this briefing may state a pace/ETA at all, and when it may, the hedge travels WITH the claim.
      // Fixtures that predate `forecast` compose as "no fit" and keep their raw etaDays; a real
      // listGoals row always carries the fit, so a sub-gate slope cannot leak onto the board PDF (G4).
      const read = composeGoal(g.forecast ?? null, g, {
        current: g.current,
        target: g.target,
        targetDate: g.targetDate ?? null,
      });
      return {
        label: g.label,
        current: g.current,
        target: g.target,
        pct: g.pct,
        pctBasis: g.pctBasis,
        pctLabel: g.pctLabel,
        pace: g.pace,
        etaDays: read.insufficiency ? null : g.etaDays,
        headline: read.headline,
        confidence: read.confidence,
        basis: read.basis,
        insufficiency: read.insufficiency,
      };
    }),
    regressionCount: movers?.regressers.length ?? 0,
    recommendations: orgRecs ?? [],
    proof: practices ? buildPracticeLibrarySummary(orgSlug, practices, playbooks ?? [], playbookAdoption).rollout : null,
    loopProof: buildLoopProof(loopEvents),
    narrative: null,
  };
}

/** One prose line for the practice-rollout proof — shared by the exec page, the board PDF, the share
 *  page and the markdown so the four can't drift (the valueRealizedLine pattern). Null when no
 *  practice was ever applied OR nothing is in flight: the proof section only appears when there is
 *  proof, never as "0 · 0". */
/**
 * The loop's proof, folded from the union. Null when no lane has both scan ends — so the LINE is
 * absent rather than printed as "0 lanes · 0 points", the same contract `briefingProofLine` has.
 */
export function buildLoopProof(events: readonly ImprovementEvent[]): ExecBriefing["loopProof"] {
  const branch = events.filter((e) => e.basis === "branch" && e.verified);
  const merged = events.filter((e) => e.source === "loop" && e.basis === "merged").length;
  if (branch.length === 0 && merged === 0) return null;
  return {
    lanes: branch.length,
    points: branch.length > 0 ? branch.reduce((n, e) => n + (e.dimPoints ?? 0), 0) : null,
    merged,
  };
}

// Preserve the public module entry point while presentation lives separately.
export { engineMixLabel, engineMixCaveat, briefingTrajectory, briefingTrajectoryNote, briefingGoal, briefingGoalLine, briefingGoalStats, valueRealizedLine, valueRealizedHeading, benchmarkCaption, movementLine, briefingHasScore, scoreValue, briefingLevelCaption, noScoreLine, scoreBasisLine, mockDisclosure, coverageLine, briefingLoopProofLine, briefingProofLine, briefingNextMove, nextMoveLine } from './briefing-format';
export { briefingMarkdown } from './briefing-markdown';
