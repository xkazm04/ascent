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
} from "@/lib/db";
import { getOrgEngineMix, getOrgRecsActioned, type EngineMixEntry } from "@/lib/db/org";
import { getOrgPractices, getPlaybookAdoption, listPlaybooks } from "@/lib/db";
import { buildPracticeLibrarySummary } from "@/lib/org/practice-library";
import { forecastHeadline } from "@/lib/maturity/forecast";
import { DIMENSION_BY_ID, levelForScore } from "@/lib/maturity/model";
import { providerLabel as engineLabel } from "@/lib/llm/config";
import type { DimensionId } from "@/lib/types";

/** "Claude CLI ×18, Mock ×2" — the period's scoring provenance, busiest engine first. */
export function engineMixLabel(mix: EngineMixEntry[]): string {
  return mix.map((e) => `${engineLabel(e.provider)} ×${e.count}`).join(", ");
}

/** The mock-provenance caveat for the period, or null when every score came from a live engine.
 *  Fires for ANY mock presence: "some scores…" on a partial fallback, and the stronger "all scores…"
 *  when the entire period was mock-scored. Previously an ALL-mock period got NO caveat anywhere (the
 *  old `engineMixDegraded` required mock AND real), so the most degraded possible quarter — 100%
 *  synthetic scores — was the one case the honesty machinery stayed silent on. A demo deployment that
 *  wants a clean read should gate on an explicit config flag, not on the shape of the mix.
 *  (executive-briefing 07-16 #3) */
export function engineMixCaveat(mix: EngineMixEntry[]): string | null {
  const mock = mix.find((e) => e.provider === "mock")?.count ?? 0;
  if (mock === 0) return null;
  const real = mix.reduce((a, e) => a + (e.provider === "mock" ? 0 : e.count), 0);
  return real > 0
    ? "some scores this period used the deterministic mock engine, not the live model"
    : "all scores this period used the deterministic mock engine, not the live model";
}

/** "trend confidence 30% · noisy" — the same hedge the exec page shows under the trajectory headline,
 *  so the board PDF and the shared read-only link can't present a low-R² projection as a firm headline.
 *  Null when there's no confidence figure (too little history). `< 50` (R²) is the "noisy" threshold. */
export function forecastConfidenceNote(confidence: number | null): string | null {
  if (confidence == null) return null;
  return `trend confidence ${confidence}%${confidence < 50 ? " · noisy" : ""}`;
}

/** One-line value-realization summary ("3 recommendations completed · fleet +6 pts · 2 repos leveled
 *  up"), or null when nothing measurable happened this period — so the renewal line only appears when
 *  there's value to show, never as an empty "0 · 0 · 0". Shared by the exec page and the markdown.
 *
 *  UAT DANA-L1-012 — `scannedRepos` names the basis of the points figure. `pointsMoved` is the
 *  fleet-wide average delta over every SCANNED repo, while the movement line beside it counts only
 *  repos with a COMPARABLE prior scan. A live board PDF put "fleet -6 pts" next to "Of 2 repositories
 *  comparable across the period, 0 improved and 0 regressed", and the reader could not reconcile them:
 *  "A board member does not need to know the word 'cohort-matched'; they need the page not to
 *  contradict itself." The two numbers were never in conflict — only one of them stated its scope. */
export function valueRealizedLine(vr: ExecBriefing["valueRealized"], scannedRepos?: number): string | null {
  const parts: string[] = [];
  if (vr.recsActioned > 0) parts.push(`${vr.recsActioned} recommendation${vr.recsActioned === 1 ? "" : "s"} completed`);
  else if (vr.recsEngaged > 0) parts.push(`${vr.recsEngaged} recommendation${vr.recsEngaged === 1 ? "" : "s"} actioned`);
  if (vr.pointsMoved != null && vr.pointsMoved !== 0) {
    const basis = scannedRepos && scannedRepos > 0 ? ` across ${scannedRepos} scanned repo${scannedRepos === 1 ? "" : "s"}` : "";
    parts.push(`fleet ${vr.pointsMoved > 0 ? "+" : ""}${vr.pointsMoved} pts${basis}`);
  }
  if (vr.reposPromoted > 0) parts.push(`${vr.reposPromoted} repo${vr.reposPromoted === 1 ? "" : "s"} leveled up`);
  return parts.length ? parts.join(" · ") : null;
}

/**
 * The HEADING the value-realized line is printed under — "Value this period" only when the period
 * actually produced value.
 *
 * UAT DANA-L1-010. `valueRealizedLine` pushes `pointsMoved` sign-blind, so the live board PDF printed
 * *"Value this period: 1 recommendation completed · fleet −6 pts"* — a fleet REGRESSION under the word
 * "Value", on the artifact most likely to leave the building unedited. The reader's verdict was not
 * "formatting bug": *"That is the tool not knowing which direction is good — and the sign is right
 * there in the variable."*
 *
 * The fix is a heading, not a filter: the regression is still printed, in full, with its basis. G1 —
 * a briefing may never become quieter by hiding its own bad news; it may only stop mislabelling it.
 */
export function valueRealizedHeading(vr: ExecBriefing["valueRealized"]): string {
  return vr.pointsMoved != null && vr.pointsMoved < 0 ? "Activity this period" : "Value this period";
}

/**
 * Caption for the benchmark percentile tile — what the percentile is measured AGAINST, or why there
 * isn't one.
 *
 * UAT DANA-L1-011/-012: the tile printed its corpus size even when the percentile itself had been
 * suppressed, so a board slide carried a headline tile reading "PERCENTILE — vs 1 repos".
 * *"'Versus one repo' is not a benchmark, it's an apology, and it's sitting in a headline slot on a
 * page with my org's name at the top."* A suppressed percentile now says why it is absent instead of
 * quoting the corpus that was too small to produce it.
 */
export function benchmarkCaption(benchmark: ExecBriefing["benchmark"]): string {
  if (!benchmark || benchmark.corpusRepos === 0) return "no corpus yet";
  if (benchmark.percentile == null) return "not enough peers to rank";
  return `vs ${benchmark.corpusRepos} repos in the public corpus`;
}

/**
 * The movement line's denominator, stated. UAT DANA-L1-012 — "Of 2 repositories comparable across the
 * period" sat on the same page as "6 of 6 repositories scanned" with nothing saying the 2 was a subset
 * of the 6. Returns null when nothing is comparable (the callers already skip the line then).
 */
export function movementLine(movement: ExecBriefing["movement"], scannedRepos: number): string | null {
  if (movement.compared <= 0) return null;
  const of = scannedRepos > 0 ? ` (of ${scannedRepos} scanned)` : "";
  return `${movement.up + movement.down} of ${movement.compared} repos with a comparable prior scan moved${of} (${movement.up} up / ${movement.down} down)`;
}

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
  pct: number;
  pace: string;
  etaDays: number | null;
}

export interface ExecBriefing {
  org: string;
  periodTitle: string;
  generatedOn: string; // YYYY-MM-DD
  maturity: { overall: number; levelId: string; levelName: string; adoption: number; rigor: number };
  coverage: { scanned: number; total: number };
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
    /** Per-dimension now/prior/delta, biggest movers first (capped). */
    dims: { dimId: string; label: string; now: number; prior: number; delta: number }[];
  } | null;
  forecastHeadline: string | null;
  /** Trend confidence (R² as 0–100) behind the forecast headline; null when there's too little history.
   *  Carried so the executive read shows the same "· noisy" honesty the overview Trajectory card does. */
  forecastConfidence: number | null;
  /** Which inference engine(s) produced this period's scores — provenance so a mock-degraded quarter
   *  is auditable in the durable briefing, not just the transient scan stream. */
  engineMix: EngineMixEntry[];
  /** Fleet adoption rate (0..100) — share of scanned repos at a HIGH-adoption posture (AI-Native or
   *  Fast & Ungoverned). The "is the standardization landing across the fleet" number a platform lead
   *  tracks cycle-over-cycle; null when nothing is scanned. */
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
  /** Optional LLM-written executive narrative (G5-03). NEVER produced by `buildExecBriefing` — a
   *  deliverable path opts in explicitly via `attachBriefingNarrative` (see ./briefing-narrative),
   *  which is grounded strictly in the figures above and degrades to deterministic copy. Null/absent
   *  means "not requested", which every renderer must treat as "render no narrative". */
  narrative?: string | null;
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

  const [rollup, benchmark, movers, goals, priorRollup, engineMix, recsActivity, orgRecs, practices, playbooks, playbookAdoption] = await Promise.all([
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
  ]);
  if (!rollup || rollup.scannedCount === 0) return null;

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
    priorRollup && priorRollup.scannedCount > 0
      ? (() => {
          const priorBy = new Map(priorRollup.dimAverages.map((d) => [d.dimId, d.avg]));
          return {
            overall: priorRollup.avgOverall,
            adoption: priorRollup.avgAdoption,
            rigor: priorRollup.avgRigor,
            dOverall: rollup.avgOverall - priorRollup.avgOverall,
            dAdoption: rollup.avgAdoption - priorRollup.avgAdoption,
            dRigor: rollup.avgRigor - priorRollup.avgRigor,
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
    periodDelta: rollup.baseline ? rollup.avgOverall - rollup.baseline.avgOverall : null,
    priorPeriod,
    forecastHeadline: rollup.forecast ? forecastHeadline(rollup.forecast) : null,
    // forecast.ts explicitly warns NOT to render fitQuality as a hard confidence % when `lowData` is
    // set: OLS through 1–2 points fits perfectly by construction (fitQuality=1), so a 2-scan forecast
    // would otherwise show "trend confidence 100%" in the board PDF. Suppress the number on low data —
    // the trajectory headline still renders, just without a bogus confidence.
    forecastConfidence:
      rollup.forecast && !rollup.forecast.lowData ? Math.round(rollup.forecast.fitQuality * 100) : null,
    engineMix,
    adoptionRate:
      rollup.scannedCount > 0
        ? Math.round((((rollup.postureCounts["ai-native"] ?? 0) + (rollup.postureCounts["ungoverned"] ?? 0)) / rollup.scannedCount) * 100)
        : null,
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
    goals: (goals ?? []).map((g) => ({
      label: g.label,
      current: g.current,
      target: g.target,
      pct: g.pct,
      pace: g.pace,
      etaDays: g.etaDays,
    })),
    regressionCount: movers?.regressers.length ?? 0,
    recommendations: orgRecs ?? [],
    proof: practices ? buildPracticeLibrarySummary(orgSlug, practices, playbooks ?? [], playbookAdoption).rollout : null,
    narrative: null,
  };
}

/** One prose line for the practice-rollout proof — shared by the exec page, the board PDF, the share
 *  page and the markdown so the four can't drift (the valueRealizedLine pattern). Null when no
 *  practice was ever applied OR nothing is in flight: the proof section only appears when there is
 *  proof, never as "0 · 0". */
export function briefingProofLine(p: ExecBriefing["proof"]): string | null {
  if (!p || (p.open === 0 && p.merged === 0)) return null;
  const parts: string[] = [];
  if (p.merged > 0) parts.push(`${p.merged} improvement PR${p.merged === 1 ? "" : "s"} merged from the Practice Library`);
  if (p.open > 0) parts.push(`${p.open} still open`);
  if (p.lift != null && p.liftPractices > 0) {
    parts.push(
      `${p.lift >= 0 ? "+" : ""}${p.lift} avg measured dimension lift across ${p.liftPractices} practice${p.liftPractices === 1 ? "" : "s"}`,
    );
  } else if (p.merged > 0) {
    // Honesty over silence: merged work with no measured lift yet is a real state the reader should
    // see, not a blank — the same framing PracticeRolloutStrip uses.
    parts.push("no post-merge lift measured yet");
  }
  return parts.join(" · ");
}

/** The single ranked next move, resolved from the briefing's own `recommendations` list. Null when
 *  nothing qualifies — callers omit the section. This is the ONLY sanctioned way to answer "what
 *  should this fleet do next"; there is deliberately no dimension-based fallback (G5-02). */
export function briefingNextMove(b: ExecBriefing): OrgRec | null {
  // Defensive `?? []`: older fixtures / previously-serialized briefings predate this field, and the
  // failure mode of reading it blind is a crashed board PDF (same reasoning as BriefingMove.fullName).
  return (b.recommendations ?? [])[0] ?? null;
}

/** One prose line for the ranked next move — the exact sentence the markdown export and the board
 *  PDF both print, so the two can't drift. Every number in it comes from the rec row itself. */
export function nextMoveLine(rec: OrgRec, scannedRepos?: number): string {
  const dimLabel = DIMENSION_BY_ID[rec.dimId as DimensionId]?.name ?? rec.dimId;
  // UAT DANA-L1-012 — "shared by 3 repositories" was the fourth unlabelled repository denominator on
  // one board page. It is a subset of the scanned set; say so.
  const repos =
    scannedRepos && scannedRepos > 0
      ? `${rec.repoCount} of the ${scannedRepos} scanned repositor${scannedRepos === 1 ? "y" : "ies"}`
      : `${rec.repoCount} repositor${rec.repoCount === 1 ? "y" : "ies"}`;
  const gain =
    rec.projectedPoints != null
      ? ` Closing it is worth about +${rec.projectedPoints} maturity points on each affected repository${rec.liftsRepos > 0 ? `, advancing ${rec.liftsRepos} of them to the next level` : ""}.`
      : "";
  return `${rec.title} — the widest shared gap across the fleet (${rec.dimId} ${dimLabel}, ${rec.impact} impact, shared by ${repos}).${gain}`;
}

/**
 * Serialize a briefing to a self-contained markdown brief — the "Copy for LLM" payload. It states the
 * current standing, strengths/weaknesses, movement and goals, and ends with an explicit ASK so a dev
 * can paste it straight into Claude Code / an LLM and get back the highest-leverage next actions.
 */
export function briefingMarkdown(b: ExecBriefing): string {
  const out: string[] = [];
  const delta = b.periodDelta == null ? "" : ` (${b.periodDelta >= 0 ? "+" : ""}${b.periodDelta} vs ${b.periodTitle} start)`;
  const moveLine = (arrow: string, m: BriefingMove) =>
    `- ${arrow} ${m.name}: ${m.dOverall >= 0 ? "+" : ""}${m.dOverall}${m.levelFrom !== m.levelTo ? ` (${m.levelFrom}→${m.levelTo})` : ""}`;

  out.push(`# Ascent — AI-native engineering maturity briefing: ${b.org}`);
  out.push(`Generated ${b.generatedOn} · period: ${b.periodTitle}`);
  out.push("");
  out.push("## Standing");
  out.push(`- Overall maturity: **${b.maturity.overall}/100** (${b.maturity.levelId} ${b.maturity.levelName})${delta}`);
  out.push(`- AI Adoption: ${b.maturity.adoption}/100 · Engineering Rigor: ${b.maturity.rigor}/100`);
  out.push(`- Coverage: ${b.coverage.scanned}/${b.coverage.total} repositories scanned`);
  const vline = valueRealizedLine(b.valueRealized, b.coverage.scanned);
  if (vline) out.push(`- ${valueRealizedHeading(b.valueRealized)}: ${vline}`);
  if (b.adoptionRate != null) out.push(`- Fleet adoption: ${b.adoptionRate}% of scanned repos at a high AI-adoption posture`);
  if (b.benchmark?.percentile != null) {
    out.push(`- Benchmark: ${b.benchmark.percentile}th percentile ${benchmarkCaption(b.benchmark)} (corpus avg ${b.benchmark.corpusAvgOverall})`);
  }
  if (b.benchmark?.cohort && b.benchmark.cohort.overallPercentile != null) {
    const c = b.benchmark.cohort;
    out.push(
      `- Peer cohort (${c.language}): ${c.overallPercentile}th percentile overall vs ${c.repos} ${c.language} repos${c.adoptionPercentile != null ? `; ${c.adoptionPercentile}th on AI adoption` : ""}`,
    );
  }
  if (b.forecastHeadline)
    out.push(
      `- Trajectory: ${b.forecastHeadline}${b.forecastConfidence != null ? ` (trend confidence ${b.forecastConfidence}%${b.forecastConfidence < 50 ? ", noisy" : ""})` : ""}`,
    );
  if (b.engineMix.length) {
    const caveat = engineMixCaveat(b.engineMix);
    out.push(`- Scored by: ${engineMixLabel(b.engineMix)}${caveat ? ` — ⚠ ${caveat}` : ""}`);
  }
  if (b.priorPeriod) {
    const p = b.priorPeriod;
    const d = (n: number) => `${n >= 0 ? "+" : ""}${n}`;
    out.push("");
    out.push("## vs previous period");
    out.push(`- Overall ${p.overall} → ${b.maturity.overall} (${d(p.dOverall)}) · Adoption ${d(p.dAdoption)} · Rigor ${d(p.dRigor)}`);
    for (const dim of p.dims.filter((x) => x.delta !== 0)) {
      out.push(`- ${dim.dimId} ${dim.label}: ${dim.prior} → ${dim.now} (${d(dim.delta)})`);
    }
  }
  out.push("");
  out.push("## Strengths (top dimensions)");
  for (const d of b.strengths) out.push(`- ${d.dimId} ${d.label}: ${d.avg}/100`);
  out.push("");
  out.push("## Weakest dimensions (where to focus)");
  for (const d of b.risks) out.push(`- ${d.dimId} ${d.label}: ${d.avg}/100`);
  if (b.security) out.push(`- Security (${b.security.dimId} ${b.security.label}): ${b.security.avg}/100`);
  if (b.topGainers.length || b.topRegressions.length) {
    out.push("");
    out.push("## Movement this period");
    const mline = movementLine(b.movement, b.coverage.scanned);
    if (mline) out.push(`- ${mline}`);
    for (const m of b.topGainers) out.push(moveLine("▲", m));
    for (const m of b.topRegressions) out.push(moveLine("▼", m));
  }
  if (b.goals.length) {
    out.push("");
    out.push("## Goals");
    for (const g of b.goals) {
      out.push(`- ${g.label}: ${g.current}/${g.target} (${g.pct}%, ${g.pace}${g.etaDays != null ? `, ETA ~${g.etaDays}d` : ""})`);
    }
  }
  // Proof before the ask: the rollout numbers are the briefing's evidence that acting on the last
  // ask worked. Fleet-wide by construction (practices aren't segment-scoped) — say so.
  const proofLine = briefingProofLine(b.proof ?? null);
  if (proofLine) {
    out.push("");
    out.push("## Proof — improvement shipped and measured");
    out.push(`- Fleet-wide: ${proofLine}`);
  }
  // Name the recommended next move from the SAME ranked list the on-screen page renders (G5-02).
  // This used to be `risks[0] ?? security`, computed only here: on a small, high-scoring fleet with
  // an empty `risks` list it printed "the fleet's weakest dimension" about D9 even when D9 was the
  // fleet's STRONGEST dimension — a board document naming a strength as the weakness. There is no
  // dimension fallback any more: no qualifying recommendation ⇒ no section.
  const move = briefingNextMove(b);
  if (move) {
    out.push("");
    out.push("## Recommended next move");
    out.push(nextMoveLine(move, b.coverage.scanned));
    const rest = (b.recommendations ?? []).slice(1);
    if (rest.length > 0) {
      out.push("");
      out.push("Next-widest gaps:");
      for (const rec of rest) {
        out.push(`- ${rec.title} (${rec.dimId}, ${rec.impact} impact, ${rec.repoCount} repo${rec.repoCount === 1 ? "" : "s"})`);
      }
    }
  }
  out.push("");
  out.push("## Ask");
  out.push(
    move
      ? `Elaborate the recommended move above ("${move.title}", ${move.dimId}) into concrete, repo-level steps: for each affected repository, the specific change to make and the practice that addresses it — then any second-order move across the next-widest gaps listed above.`
      : "Given this AI-native engineering maturity briefing, propose the highest-leverage actions to raise overall maturity next quarter, focused on the weakest dimensions above. For each action give: the concrete change, which repositories it applies to, and which dimension it should move.",
  );
  return out.join("\n");
}
