// Shared, PURE derivations + filter model for the Overview repos×time view (Category Rollup). No React,
// so server and client both import it. Joins the per-repo history query (getOrgRepoHistories) with each
// repo's latest snapshot into one model of where every repo stands NOW and how far it has moved across
// its own historical scans — plus the enum-filter helpers the header dropdowns drive. Colors/tones come
// from the brand helpers + canonical enums, never hand-picked ad hoc.

import type { OrgRepoHistory, RepoTrajectoryPoint } from "@/lib/db";
import type { LevelId, TechStack } from "@/lib/types";
import { toneFor, DIRECTION_TONE } from "@/components/ui/format";

// Barrel — the display maps (posture dots, stack-role labels) and the enum-filter model moved to the
// co-located repoTrajectoryFilters.ts under the 200-LOC rule; this file stays the one import surface
// for the view, so every name it used to export is still exported here.
export {
  POSTURE_DOT,
  POSTURE_DOT_FALLBACK,
  STACK_ROLE_LABEL,
  applyFilters,
  emptyFilters,
  filtersActive,
  levelsPresent,
  posturesPresent,
  rolesOf,
  rolesPresent,
} from "./repoTrajectoryFilters";
export type { RepoFilters } from "./repoTrajectoryFilters";

/** The latest-snapshot half of the join — a lean slice of getOrgRollup's OrgRepoRow. */
export interface RepoLatest {
  fullName: string;
  name: string;
  owner: string;
  techStack: TechStack | null;
  latest: { level: string; overall: number; adoption: number; rigor: number; posture: string; scannedAt: string; engine: string } | null;
}

export interface RepoTrajectory {
  fullName: string;
  name: string;
  owner: string;
  techStack: TechStack | null;
  level: LevelId;
  overall: number;
  adoption: number;
  rigor: number;
  posture: string;
  scannedAt: string;
  /** Engine of the CURRENT (latest) scan — "mock" = deterministic floor (placeholder), else live. */
  engine: string;
  points: RepoTrajectoryPoint[];
  scans: number;
  /** Net move across the window (first → last in-window point); null when < 2 in-window scans. */
  deltaWindow: number | null;
  /** Most recent single-step move (last two in-window points); null when < 2. */
  deltaLast: number | null;
  /** The window delta's two endpoints were produced by DIFFERENT engines (e.g. a mock seed → a live
   *  re-scan). Such a delta conflates an engine change with real maturity movement, so the UI mutes it. */
  deltaCrossesEngine: boolean;
  tone: keyof typeof DIRECTION_TONE;
  lo: number;
  hi: number;
}

/** A scan engine is the deterministic mock FLOOR (a placeholder), not a real graded model, when "mock". */
export function isMockEngine(engine: string): boolean {
  return engine === "mock";
}

export function buildTrajectories(repos: RepoLatest[], histories: OrgRepoHistory[]): RepoTrajectory[] {
  const byName = new Map(histories.map((h) => [h.fullName, h]));
  const out: RepoTrajectory[] = [];
  for (const r of repos) {
    if (!r.latest) continue;
    const points = byName.get(r.fullName)?.points ?? [];
    const n = points.length;
    const deltaWindow = n >= 2 ? points[n - 1]!.overall - points[0]!.overall : null;
    const deltaLast = n >= 2 ? points[n - 1]!.overall - points[n - 2]!.overall : null;
    const deltaCrossesEngine = n >= 2 && points[0]!.engine !== points[n - 1]!.engine;
    const scores = points.map((p) => p.overall);
    out.push({
      fullName: r.fullName,
      name: r.name,
      owner: r.owner,
      techStack: r.techStack,
      level: r.latest.level as LevelId,
      overall: r.latest.overall,
      adoption: r.latest.adoption,
      rigor: r.latest.rigor,
      posture: r.latest.posture,
      scannedAt: r.latest.scannedAt,
      engine: r.latest.engine,
      points,
      scans: n,
      deltaWindow,
      deltaLast,
      deltaCrossesEngine,
      tone: toneFor(deltaWindow ?? 0),
      lo: scores.length ? Math.min(r.latest.overall, ...scores) : r.latest.overall,
      hi: scores.length ? Math.max(r.latest.overall, ...scores) : r.latest.overall,
    });
  }
  return out;
}

// ── Fleet summary (masthead + group aggregates) ─────────────────────────────────

/** Repos whose window delta is REAL movement — a genuine code-change delta, excluding the null (single
 *  scan) and engine-transition (mock → live) cases that aren't real maturity movement. The honest
 *  denominator for "improving / slipping" counts and any average-move aggregate. */
export function movedRepos(rows: RepoTrajectory[]): RepoTrajectory[] {
  return rows.filter((r) => r.deltaWindow != null && !r.deltaCrossesEngine);
}

/** Average of a set of window deltas over the repos that really moved; null when none did. */
export function avgRealMove(rows: RepoTrajectory[]): number | null {
  const moved = movedRepos(rows);
  return moved.length ? Math.round(moved.reduce((a, r) => a + (r.deltaWindow ?? 0), 0) / moved.length) : null;
}

/** Repos whose CURRENT score is a real graded model result, not the deterministic mock floor. The
 *  honest denominator for any AVERAGE SCORE — the score twin of `movedRepos` for average movement.
 *  A mock score is a placeholder the scanner emits without a model; averaging it in reports a
 *  measurement over a set that was partly never measured. */
export function realScoredRepos(rows: RepoTrajectory[]): RepoTrajectory[] {
  return rows.filter((r) => !isMockEngine(r.engine));
}

/**
 * Average maturity over the LIVE-scored repos; null when none of them is live-scored.
 *
 * Null, never 0 — the same contract `avgRealMove` already holds. `Math.round(0/0)` is NaN and a
 * `xs.length ? … : 0` guard would hand back a 0 that renders in alarm-red as a catastrophic fleet
 * grade. "We have no measured score for this set" is a different statement from "this set scores 0",
 * and only the caller's no-score rendering can say it.
 */
export function avgRealScore(rows: RepoTrajectory[]): number | null {
  const real = realScoredRepos(rows);
  return real.length ? Math.round(real.reduce((a, r) => a + r.overall, 0) / real.length) : null;
}

export interface FleetSummary {
  repos: number;
  /** Average maturity over the LIVE-scored repos only; null when the set has none (all-mock, or
   *  filtered to nothing). Mock placeholders are excluded, matching `avgMove` — see avgRealScore. */
  avgOverall: number | null;
  /** The denominator behind `avgOverall` — how many of `repos` carry a real graded score. */
  realScored: number;
  /** repos with real (non-engine-transition) movement — the movement denominator. */
  moved: number;
  improving: number;
  slipping: number;
  holding: number;
  avgMove: number | null;
  /** repos whose CURRENT score is a mock placeholder (not a live grade). */
  mock: number;
}

export function summarize(rows: RepoTrajectory[]): FleetSummary {
  const moved = movedRepos(rows);
  const improving = moved.filter((r) => r.tone === "rising").length;
  const slipping = moved.filter((r) => r.tone === "falling").length;
  return {
    repos: rows.length,
    avgOverall: avgRealScore(rows),
    realScored: realScoredRepos(rows).length,
    moved: moved.length,
    improving,
    slipping,
    holding: moved.length - improving - slipping,
    avgMove: avgRealMove(rows),
    mock: rows.filter((r) => isMockEngine(r.engine)).length,
  };
}
