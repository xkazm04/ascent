// Pure presentation rules shared by briefing surfaces and exports.
import type { ExecBriefing } from './briefing';
import type { OrgRec } from '@/lib/db';
import type { EngineMixEntry } from '@/lib/db/org';
import type { DimensionId } from '@/lib/types';
import { DIMENSION_BY_ID } from '@/lib/maturity/model';
import { trajectoryNote, type TrajectoryRead } from '@/lib/maturity/forecast';
import { providerLabel as engineLabel } from '@/lib/llm/config';


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

/** The trajectory as the briefing's renderers must present it — the composed read of the fit behind
 *  `forecastHeadline` / `forecastConfidence` / `forecastBasis` / `forecastInsufficiency`.
 *
 *  EVERY briefing surface (the Trajectory card, the board PDF, the read-only share page and the
 *  "Copy for LLM" markdown) reads the line through this one function, so the four artifacts a board
 *  might see cannot disagree about the same fit. Previously each assembled its own line and guarded
 *  the hedge on `forecastConfidence != null` — and that figure is nulled precisely when the fit is
 *  too thin to state one, so the LEAST trustworthy fit rendered the MOST confidently. (MC-B1.) */
export function briefingTrajectory(b: ExecBriefing): TrajectoryRead {
  return {
    headline: b.forecastHeadline,
    confidence: b.forecastConfidence,
    basis: b.forecastBasis ?? null,
    insufficiency: b.forecastInsufficiency ?? null,
  };
}

/** The hedge a rendered briefing headline must carry: "trend confidence 34% · noisy · fit over 9 scan
 *  days across 84 days". Null only when there is no headline to hedge. */
export function briefingTrajectoryNote(b: ExecBriefing): string | null {
  return trajectoryNote(briefingTrajectory(b));
}

/** One-line value-realization summary ("3 recommendations completed · fleet +6 pts · 2 repos leveled
 *  up"), or null when nothing measurable happened this period — so the renewal line only appears when
 *  there's value to show, never as an empty "0 · 0 · 0". Shared by the exec page and the markdown.
 *
 *  UAT DANA-L1-012 — `liveScoredRepos` names the basis of the points figure. `pointsMoved` is the
 *  fleet-wide average delta over every LIVE-SCORED repo, while the movement line beside it counts only
 *  repos with a COMPARABLE prior scan. A live board PDF put "fleet -6 pts" next to "Of 2 repositories
 *  comparable across the period, 0 improved and 0 regressed", and the reader could not reconcile them:
 *  "A board member does not need to know the word 'cohort-matched'; they need the page not to
 *  contradict itself." The two numbers were never in conflict — only one of them stated its scope. */
export function valueRealizedLine(vr: ExecBriefing["valueRealized"], liveScoredRepos?: number): string | null {
  const parts: string[] = [];
  if (vr.recsActioned > 0) parts.push(`${vr.recsActioned} recommendation${vr.recsActioned === 1 ? "" : "s"} completed`);
  else if (vr.recsEngaged > 0) parts.push(`${vr.recsEngaged} recommendation${vr.recsEngaged === 1 ? "" : "s"} actioned`);
  if (vr.pointsMoved != null && vr.pointsMoved !== 0) {
    // Direction 1 — the basis is the LIVE-SCORED set, not the scanned set. `pointsMoved` is
    // `avgOverall − baseline.avgOverall`, and both of those are means over `realScoredCount`
    // (org-rollup.ts:320-326). Naming the scanned count here overstated the denominator by exactly
    // `mockCount`, on the one line a renewal conversation quotes.
    const basis =
      liveScoredRepos && liveScoredRepos > 0
        ? ` across ${liveScoredRepos} live-scored repo${liveScoredRepos === 1 ? "" : "s"}`
        : "";
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
export function movementLine(movement: ExecBriefing["movement"], liveScoredRepos: number): string | null {
  if (movement.compared <= 0) return null;
  // Direction 1 — the superset is the LIVE-SCORED set. `getOrgMovers` refuses any pair with a mock
  // endpoint (`isRealPair`, org-insights.ts), so a mock placeholder can never be one of the
  // `compared` repos; quoting the scanned count as the superset invited the reader to subtract
  // repos that were never in the running.
  const of = liveScoredRepos > 0 ? ` (of ${liveScoredRepos} live-scored)` : "";
  return `${movement.up + movement.down} of ${movement.compared} repos with a comparable prior scan moved${of} (${movement.up} up / ${movement.down} down)`;
}

/**
 * Does this briefing have a fleet score AT ALL?
 *
 * Direction 1. `getOrgRollup` computes `avgOverall/avgAdoption/avgRigor` over the LIVE-SCORED repos
 * and states the contract in its own doc comment: "when that denominator is 0 this number is a
 * division guard (0), NOT a grade, and every renderer must land on its no-score path". Before this,
 * `buildExecBriefing` guarded only on `scannedCount === 0`, so an all-mock fleet produced
 * `maturity.overall = 0` → `levelForScore(0)` → L1, and four surfaces printed a grade of "0/100
 * (L1 Ad hoc)" for a fleet that had never been measured. This is the predicate every renderer gates
 * on instead.
 */
export function briefingHasScore(b: Pick<ExecBriefing, "realScoredCount">): boolean {
  return b.realScoredCount > 0;
}

/** A fleet average as a renderer must print it: the figure, or an em dash when there is no score. */
export function scoreValue(b: Pick<ExecBriefing, "realScoredCount">, value: number): string {
  return briefingHasScore(b) ? String(value) : "—";
}

/** "L3 Managed" — the level caption under the headline score. Null when there is no score: a level
 *  derived from a division guard is L1, the most damaging possible misreading of an unmeasured fleet. */
export function briefingLevelCaption(b: ExecBriefing): string | null {
  return briefingHasScore(b) ? `${b.maturity.levelId} ${b.maturity.levelName}` : null;
}

/** THE sentence a no-score fleet gets in place of a grade, on every surface. Null when there is a
 *  score. Never a number: the point is that there is nothing to state. */
export function noScoreLine(b: ExecBriefing): string | null {
  if (briefingHasScore(b)) return null;
  return "No live-scored repositories in this period — every scanned repository's latest score is a mock placeholder, so no fleet average can be stated.";
}

/** The score's BASIS, stated separately from the coverage line: `coverage` answers "how much of the
 *  fleet did we look at", this answers "what is the average actually averaged over". Null when there
 *  is no score (the surface prints {@link noScoreLine} instead). */
export function scoreBasisLine(b: ExecBriefing): string | null {
  if (!briefingHasScore(b)) return null;
  const n = b.realScoredCount;
  return `averaged over ${n} live-scored repositor${n === 1 ? "y" : "ies"}`;
}

/** "2 mock placeholders excluded from every average" — the disclosure a nonzero `mockCount` obliges.
 *  Null when every scanned repo carries a real graded score.
 *
 *  This is the gap `engineMixCaveat` cannot cover, and the two are NOT redundant (G9): the engine mix
 *  counts scans that ran INSIDE the window, while the averages read each repo's latest scan
 *  at-or-before the upper bound. A fleet whose mock scans predate the window gets no engine-mix
 *  caveat at all and still has its averages computed over a shrunken denominator. */
export function mockDisclosure(b: Pick<ExecBriefing, "mockCount">): string | null {
  if (b.mockCount <= 0) return null;
  return `${b.mockCount} mock placeholder${b.mockCount === 1 ? "" : "s"} excluded from every average`;
}

/** "Coverage: 8/12 repositories scanned" — one definition for the PDF, the markdown, the tab and the
 *  share page (G12). This denominator is deliberately the SCANNED set: it answers how much of the
 *  fleet was looked at, which is a different question from what the averages stand on. */
export function coverageLine(b: ExecBriefing): string {
  return `Coverage: ${b.coverage.scanned}/${b.coverage.total} repositories scanned`;
}

/**
 * One prose line for the loop's proof — printed by the exec banner, the PDF, the share page and the
 * markdown from THIS function, so the four cannot drift.
 *
 * It says "on branches, not merged" in words. That phrase is the whole point of the line: the number
 * beside it is real, verified, independently rescanned movement, and it is also not yet bought. A
 * board reading "12 points" without that clause would reasonably believe the change had landed.
 */
export function briefingLoopProofLine(p: ExecBriefing["loopProof"]): string | null {
  if (!p || (p.lanes === 0 && p.merged === 0)) return null;
  const parts: string[] = [];
  if (p.lanes > 0 && p.points != null) {
    parts.push(
      `${p.points >= 0 ? "+" : ""}${p.points} verified dimension point${Math.abs(p.points) === 1 ? "" : "s"} from ${p.lanes} local loop lane${p.lanes === 1 ? "" : "s"} — on branches, not merged`,
    );
  } else if (p.lanes > 0) {
    parts.push(`${p.lanes} local loop lane${p.lanes === 1 ? "" : "s"} awaiting measurement`);
  }
  if (p.merged > 0) parts.push(`${p.merged} loop PR${p.merged === 1 ? "" : "s"} merged and verified`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

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
  //
  // Direction 1 deliberately does NOT move this one onto the live-scored denominator, unlike the
  // value and movement lines. `rec.repoCount` counts repos whose LATEST scan carries this open
  // recommendation, and `getOrgRecommendations` reads every scanned repo including the mock-floored
  // ones (org-insights.ts) — so "6 of the 4 live-scored repositories" would be arithmetically
  // impossible copy. G4: the clause names the denominator the figure is actually drawn from.
  const repos =
    scannedRepos && scannedRepos > 0
      ? `${rec.repoCount} of the ${scannedRepos} scanned repositor${scannedRepos === 1 ? "y" : "ies"}`
      : `${rec.repoCount} repositor${rec.repoCount === 1 ? "y" : "ies"}`;
  const gain =
    rec.projectedPoints != null
      ? ` Closing it is worth about +${rec.projectedPoints} maturity points on each affected repository${rec.liftsRepos > 0 ? `, advancing ${rec.liftsRepos} of them to the next level` : ""}.`
      : "";
  return `${rec.title}: the widest shared gap across the fleet (${rec.dimId} ${dimLabel}, ${rec.impact} impact, shared by ${repos}).${gain}`;
}