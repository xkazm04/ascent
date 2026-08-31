// A RED BASELINE AS A STANDING FACT — the read half.
//
// `LoopRunLane.verifyVerdict` already carries every measurement the degradation guard has ever made.
// Nothing new is stored here and nothing is recomputed: this module folds that column into the shape
// the weekly fleet digest's standing-concerns block already renders, so a repository whose own checks
// have been failing for eleven lanes shows up in the same place, in the same voice, as a dimension
// that has been twenty-one points down for a month.
//
// WHY THE DIGEST AND NOT A NEW PANEL. Exactly the reasoning `detectStandingRegressions` records: the
// digest is the surface that goes SILENT in this scenario. Its whole contract is "a flat week stays
// quiet", and a repository that has been red since before the window looks flat to every
// movement-shaped input it has. A red baseline is a state, not an event, and the standing-concerns
// block is the only channel in the product shaped for a state.
//
// Import from the `@/lib/db` barrel.

import { dbReadSafe, getPrisma, isDbConfigured } from "@/lib/db/client";
import { getOrgBySlug } from "@/lib/db/org-shared";
import { asVerifyVerdict } from "@/lib/local/verify-options";
import {
  baselineFailureLines,
  consecutiveRedBaseline,
  redBaselineObservation,
  type BaselineLaneRow,
} from "@/lib/local/lane-baseline";

/** How many lanes are read at all. Bounded so an org with a long loop history costs one query of a
 *  known size — the same discipline `getStandingRegressions` keeps with its `lookback`. */
const LANE_LOOKBACK = 240;
/** Per repository, how far back the consecutive-red walk may reach. A run longer than this is still
 *  reported; only its stated length saturates, and the observation is a floor, never an overstatement
 *  of a run it did not see the start of. */
const PER_REPO_LOOKBACK = 24;

/** A repository whose own check was failing before the loop's session — the standing-concerns row. */
export interface RepoRedBaseline {
  repoFullName: string;
  /** The one-line, cause-free rendering (`redBaselineObservation`). */
  observation: string;
  /** Bounded, neutralized lines of the repository's own failing output. A list a reader can check,
   *  never a stated cause — the same contract the standing concerns' appeared/disappeared lines have. */
  evidence: string[];
  /** Consecutive lanes that measured it red. */
  lanes: number;
  command: string | null;
  /** ISO of the oldest lane in that run. */
  since: string;
}

type LaneRow = {
  repoFullName: string;
  verifyVerdict: string | null;
  verifyCommand: string | null;
  verifyNote: string | null;
  startedAt: Date | null;
  endedAt: Date | null;
  run: { startedAt: Date };
};

/** The lane's own clock, with the run's start as the floor — a lane row is allowed to be missing both
 *  of its own timestamps, and a concern with no date would be worse than one dated by its run. */
const laneAt = (row: LaneRow): string => (row.endedAt ?? row.startedAt ?? row.run.startedAt).toISOString();

const toBaselineRow = (row: LaneRow): BaselineLaneRow => ({
  repoFullName: row.repoFullName,
  verifyVerdict: asVerifyVerdict(row.verifyVerdict),
  verifyCommand: row.verifyCommand,
  verifyNote: row.verifyNote,
  at: laneAt(row),
});

/** ONE query: the org's most recent verdict-bearing lanes, newest lane of the newest run first.
 *  Ordered by the RUN's start and then the cycle, because a lane's own timestamps are nullable and
 *  ordering on a nullable column would sort a half-written row to the front of the history. */
async function recentVerdictLanes(orgId: string, take: number): Promise<LaneRow[]> {
  return (await getPrisma().loopRunLane.findMany({
    where: { run: { orgId }, verifyVerdict: { not: null } },
    select: {
      repoFullName: true,
      verifyVerdict: true,
      verifyCommand: true,
      verifyNote: true,
      startedAt: true,
      endedAt: true,
      run: { select: { startedAt: true } },
    },
    orderBy: [{ run: { startedAt: "desc" } }, { cycle: "desc" }],
    take,
  })) as LaneRow[];
}

/**
 * One repository's guard history, newest-first — what `leadWithRedBaseline` reads when it decides
 * whether the next lane's brief leads with the repair.
 *
 * Only lanes that RECORDED a verdict are returned. A lane still in flight has none yet, and the lane
 * asking this question is itself one of those: its own row must not be able to answer for it.
 */
export async function getRepoBaselineLanes(
  orgSlug: string,
  repoFullName: string,
  limit = PER_REPO_LOOKBACK,
): Promise<BaselineLaneRow[]> {
  if (!isDbConfigured()) return [];
  return dbReadSafe<BaselineLaneRow[]>(async () => {
    const org = await getOrgBySlug(orgSlug);
    if (!org) return [];
    const rows = (await getPrisma().loopRunLane.findMany({
      where: { run: { orgId: org.id }, repoFullName, verifyVerdict: { not: null } },
      select: {
        repoFullName: true,
        verifyVerdict: true,
        verifyCommand: true,
        verifyNote: true,
        startedAt: true,
        endedAt: true,
        run: { select: { startedAt: true } },
      },
      orderBy: [{ run: { startedAt: "desc" } }, { cycle: "desc" }],
      take: Math.max(1, Math.min(limit, PER_REPO_LOOKBACK)),
    })) as LaneRow[];
    return rows.map(toBaselineRow);
  }, []);
}

/**
 * Every repository in the org whose MOST RECENT lane measured a red baseline, longest-standing first.
 *
 * "Most recent" is the whole rule and it cuts both ways: a repository that has since been repaired
 * raises nothing (its newest lane is `verified`), and a repository red for one lane is raised
 * immediately rather than after a persistence threshold — unlike a score, a failing check has no
 * noise band to see through, and three lanes of waiting is three lanes of unverifiable commits.
 */
export async function getRedBaselines(
  orgSlug: string,
  opts: { limit?: number } = {},
): Promise<RepoRedBaseline[]> {
  if (!isDbConfigured()) return [];
  return dbReadSafe<RepoRedBaseline[]>(async () => {
    const org = await getOrgBySlug(orgSlug);
    if (!org) return [];
    const rows = await recentVerdictLanes(org.id, LANE_LOOKBACK);
    const byRepo = new Map<string, BaselineLaneRow[]>();
    for (const row of rows) {
      const list = byRepo.get(row.repoFullName) ?? [];
      if (list.length >= PER_REPO_LOOKBACK) continue;
      list.push(toBaselineRow(row));
      byRepo.set(row.repoFullName, list);
    }
    const out: RepoRedBaseline[] = [];
    for (const [repoFullName, lanes] of byRepo) {
      const run = consecutiveRedBaseline(lanes);
      if (!run) continue;
      out.push({
        repoFullName,
        observation: redBaselineObservation(run),
        evidence: baselineFailureLines(run.note),
        lanes: run.lanes,
        command: run.command,
        since: run.since,
      });
    }
    // Longest-standing first: a repository red for eleven lanes is a worse fact than one red for one,
    // and a truncated list must not drop the worse one.
    out.sort((a, b) => b.lanes - a.lanes || a.repoFullName.localeCompare(b.repoFullName));
    return opts.limit != null ? out.slice(0, Math.max(0, opts.limit)) : out;
  }, []);
}
