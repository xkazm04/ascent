// One LANE of a loop run: one repo, one cycle — worktree → local Claude agent → rescan.
//
// This is the old autopilot's inner cycle, lifted out verbatim in behaviour and made (a) durable
// (every phase transition and log line is a DB write, not a Map mutation) and (b) parallel-safe (no
// module state at all; everything a lane needs arrives as an argument). The single-repo autopilot is
// now literally "a run with one lane per cycle" — see src/lib/local/autopilot.ts.
//
// The guardrails are unchanged and each still load-bearing: an ISOLATED worktree on its own branch,
// never a push, a bounded cycle count, and a cycle that produced neither a commit nor a closed row
// ends its lane (an agent that stalled will not un-stall by being re-asked).
//
// A lane now has a KIND (src/lib/db/loop-runs-types.ts). `backlog` is everything above and stays the
// default. `foundation` and `practice` replace the agent session with a DETERMINISTIC install — the
// same generators the cloud draft-PR doors use, written into the worktree and committed — and then
// run the identical rescan + adjudication. That is deliberate: the install is only the claim, and a
// row still closes only when the next scan says the dimension moved.

import { runGit } from "@/lib/local/git";
import { LocalFsSource } from "@/lib/local/source";
import { runClaudeAgent } from "@/lib/local/agent";
import { buildFixPrompt, type FollowUpItem } from "@/lib/org/followups";
import { getOrgBacklog } from "@/lib/db/org-insights";
import { getCraftItems, getCraftLedger } from "@/lib/db/org-insights-craft";
import { axesByCoverage, emptyAxisTally } from "@/lib/scoring/craft";
// THE SHARED CLAIM PATH (moonshot #3). The lane used to claim with an unconditional
// `updateRecommendation(id, {status:"in_progress"})`, which was correct while the engine was the only
// worker and became a race the moment a remote agent could pull from the same queue. Both callers now
// go through `claimFollowups`, so the database — not the order the two happened to arrive in —
// decides who holds a row, and this lane simply works what it won.
import { claimFollowups, releaseFollowups } from "@/lib/db/followup-claims";
import { getLatestPlatformSignals, persistScanReport } from "@/lib/db";
import { scanRepository } from "@/lib/scan";
import { appendLaneLog, getLatestScanIdForRepo, updateLane, upsertLane } from "@/lib/db/loop-runs";
import type { LaneDeliverable, LoopLaneKind } from "@/lib/db/loop-runs-types";
import type { ComparableScan } from "@/lib/db/scans";
import { attributeDelivered } from "@/lib/maturity/attribution";
import { diffScans } from "@/lib/report/compare";
import { installInWorktree } from "@/lib/local/lane-install";
import { commitAgentWork } from "@/lib/local/lane-commit";
import { deriveLaneDeliverables, parseClaimLines, type AgentClaim } from "@/lib/local/lane-deliverables";
import { proposeLaneKind } from "@/lib/local/lane-kind";
import { gapSlotsAtGreen, isReservationGreen, reserveCraftSlots } from "@/lib/local/lane-reservation";
import { batchSizeOf, verifyTimeoutMsOf } from "@/lib/local/run-limits";
// THE A/B DEGRADATION GUARD. `verifyBaseline` measures the pristine worktree once per worktree and
// caches it; `verifyResult` re-runs the same command after the session, decides one of four verdicts,
// and — on `rejected` only — discards the edits IN THE THROWAWAY WORKTREE before this module gets as
// far as committing anything. See lane-guard.ts for why running a repo-authored command is bounded
// the way it is.
import { verifyBaseline, verifyResult, verifyRejectionLesson, type VerifyBaseline } from "@/lib/local/lane-guard";
// A RED BASELINE IS THE LOOP'S OWN TOP-PRIORITY WORK. When the repository's own check was already
// failing, the guard has nothing green to compare against and everything this lane commits is
// unverifiable — so the brief LEADS with the repair and the operator gets a lesson saying the loop
// noticed. See lane-baseline.ts for why a repaired repo gets no lead and why the attempt counter
// matters.
import { leadWithRedBaseline, redBaselineLesson, type BaselineLaneRow } from "@/lib/local/lane-baseline";
import { loadLaneBriefInput } from "@/lib/db/lane-brief-read";
import { getActiveDeferrals, recordLaneOutcomes } from "@/lib/db/lane-outcomes";
import { stampPlaybookApplications } from "@/lib/db/playbooks";
import { recordLoopLessons, recordRedBaselineLesson } from "@/lib/db/loop-lessons";
import { buildLaneBrief, briefSummaryLine } from "@/lib/org/lane-brief";
import { laneReportContract, readLaneReport, type LaneReport } from "@/lib/local/lane-report";
// The cost write-back and the report exclusion live in a sibling so this module stays the cycle
// orchestrator it reads as.
import { excludeLaneReport, recordAgentCost } from "@/lib/local/lane-cost";
import { takeDepNotes, type LoopWorktree } from "@/lib/local/loop-worktree";

/**
 * The DEFAULT batch — how many follow-ups (or craft rungs) one cycle dispatches when a run names no
 * size of its own. Unchanged at five, so a default run is byte-identical to every run before the
 * parameter existed; `run-limits.ts` owns the per-run override and its cap, and the reason a fixed
 * five was holding the loop back.
 */
export const BATCH_SIZE = 5;

/** Who the LOCAL engine claims as. Unchanged from the string the inline claim wrote, so the ledger's
 *  existing rows and this lane's new ones are the same actor. */
const LANE_ACTOR = "autopilot";

/** The side-effecting primitives a lane drives, injectable so tests never spawn an agent or shell. */
export interface LaneDeps {
  runAgent: typeof runClaudeAgent;
  /** The deterministic install a `foundation` / `practice` lane does instead of calling an agent. */
  install: typeof installInWorktree;
  /** Commits what the agent session left behind — see lane-commit.ts for why the LANE does this. */
  commitWork: typeof commitAgentWork;
  /** Which kind of lane a repo's next cycle should be — read from the paired working copy. */
  laneKind: typeof proposeLaneKind;
  /** Practice ids the loop has already dispatched into this repo — `laneKind`'s once-per-repo gate. */
  dispatchedPractices: (org: string, repo: string) => Promise<ReadonlySet<string>>;
  /** Scan a worktree from disk and persist it. Returns the new scan id + the ids its trailers closed. */
  rescan: (args: {
    org: string;
    repo: string;
    dir: string;
    branch: string;
    onStage: (stage: string) => void;
  }) => Promise<{ scanId: string | null; closedIds: string[]; claimedIds?: string[] }>;
  /** The repo's open follow-ups, biggest projected gain first, capped at `limit`. */
  /** The lane's before/after pair, as the ledger will read it — for the deliverable headlines. */
  loadPair: (args: { orgSlug: string; repoFullName: string; beforeScanId: string | null; afterScanId: string | null }) => Promise<{
    before: ComparableScan | null;
    after: ComparableScan | null;
  } | null>;
  /** Optional LLM polish of the derived headlines; returns the input unchanged when no model answers. */
  summarize: (list: LaneDeliverable[], orgSlug: string) => Promise<LaneDeliverable[]>;
  openBatch: (
    org: string,
    repo: string,
    limit?: number,
    opts?: { includeDeferred?: boolean; reserveCraft?: boolean },
  ) => Promise<FollowUpItem[]>;
  /** The org's own standard for this batch's dimensions — see src/lib/db/lane-brief-read.ts. */
  loadBrief: typeof loadLaneBriefInput;
  /** The agent's `.ascent/lane-report.json`, parsed. Never throws; a missing file is `parsed:false`. */
  readReport: typeof readLaneReport;
  /** This repo's PREVIOUS guard verdicts, newest-first — what tells the brief whether a red baseline
   *  is new or is the fourth lane in a row to meet it (`leadWithRedBaseline`). */
  priorBaselines: (org: string, repo: string) => Promise<BaselineLaneRow[]>;
}

export const defaultLaneDeps: LaneDeps = {
  runAgent: runClaudeAgent,
  install: installInWorktree,
  commitWork: commitAgentWork,
  laneKind: proposeLaneKind,
  rescan: rescanWorktree,
  openBatch,
  // Lazy on purpose: the read module reaches for the db client, and the lane's unit tests mock the
  // loop-runs barrel without it. A missing default here is a skipped headline, never a failed lane.
  loadPair: async (args) => (await import("@/lib/db/loop-runs-read")).getLanePair(args),
  // Lazy for the same reason as `loadPair` above, and lazier still in practice: `proposeLaneKind`
  // only calls it once a practice-shaped gap has already survived the file test.
  dispatchedPractices: async (org, repo) => (await import("@/lib/db/loop-runs-read")).listDispatchedPractices(org, repo),
  summarize: async (list, orgSlug) => {
    const { polishLaneDeliverables, resolveLaneSummaryRunner } = await import("@/lib/local/lane-summary");
    return polishLaneDeliverables(list, await resolveLaneSummaryRunner(orgSlug));
  },
  loadBrief: loadLaneBriefInput,
  readReport: readLaneReport,
  // Lazy for the same reason as `loadPair`: the read module reaches for the db client and the lane's
  // unit tests mock the loop-runs barrel without it. An empty history is "no previous lane recorded a
  // verdict", which is what a first run genuinely has — never a failed lane.
  priorBaselines: async (org, repo) => (await import("@/lib/db/loop-baselines")).getRepoBaselineLanes(org, repo),
};

export interface LaneRunInput {
  runId: string;
  org: string;
  repo: string;
  cycle: number;
  worktree: LoopWorktree;
  /** The curated batch for this lane, or null to auto-pick the top open follow-ups. */
  batch: readonly string[] | null;
  /** What this lane DOES. Defaults to the agent lane, which is what every caller meant before kinds
   *  existed. `foundation` and `practice` are deterministic file writes — see lane-install.ts. */
  kind?: LoopLaneKind;
  /** Practice Library id — required when `kind` is "practice". */
  practiceId?: string | null;
  /** One line saying why this kind was picked, for the lane log. */
  reason?: string;
  deps?: Partial<LaneDeps>;
  /** Cooperative stop, checked between phases — never mid-agent-session. */
  shouldStop?: () => boolean;
  /** What to arm this lane's agent session with, already resolved by the engine. Omitted keeps the
   *  runner's own env fallback, which is what the single-repo autopilot shim has always relied on. */
  agent?: { model?: string | null; effort?: string | null; timeoutMs?: number | null };
  /** How many items this cycle dispatches. Omitted = `BATCH_SIZE`, which is what every lane before
   *  the parameter existed used. Ignored on a CURATED batch, which names its own rows. */
  batchSize?: number | null;
  /** The A/B degradation guard for this lane. Omitted = ON with the default budget, which is the
   *  run's default posture; `{ enabled: false }` is the operator's explicit refusal to run
   *  repo-authored verification commands and restores the pre-guard behaviour exactly. */
  verify?: { enabled: boolean; timeoutMs?: number | null };
  /** Joins the two arms of one `ab` pair (MOONSHOT #27); null/absent on a `single` run. Stamped on
   *  the row so the price list can tell two arms of one experiment from two unrelated lanes. */
  abPairKey?: string | null;
}

export interface LaneRunResult {
  laneId: string | null;
  /** True when the lane committed something or closed a row — the signal the run keeps cycling on. */
  progressed: boolean;
  commits: number;
  closed: number;
  error: string | null;
}

/**
 * The dimension a batch is mostly about, or null when it is about none.
 *
 * Counted first, then broken by the higher projected-point total, then by dimension id so the answer
 * is deterministic. `null` for an empty batch or one whose items carry no dimension — and null means
 * the lane cannot open a PR (`ImprovementPr.dimId` is non-nullable), which is the correct refusal
 * rather than a fabricated dimension in the improvement ledger.
 */
export function dominantDimId(batch: readonly FollowUpItem[]): string | null {
  const tally = new Map<string, { n: number; points: number }>();
  for (const it of batch) {
    if (!it.dimId) continue;
    const cur = tally.get(it.dimId) ?? { n: 0, points: 0 };
    cur.n += 1;
    cur.points += it.projectedPoints ?? 0;
    tally.set(it.dimId, cur);
  }
  let best: string | null = null;
  let bestScore = { n: 0, points: 0 };
  for (const [dimId, score] of [...tally.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (score.n > bestScore.n || (score.n === bestScore.n && score.points > bestScore.points)) {
      best = dimId;
      bestScore = score;
    }
  }
  return best;
}

const firstLine = (s: string, max = 160): string => s.split("\n").find((l) => l.trim())?.slice(0, max) ?? "";

/** The agent's own first line gets more room than the rest of the log. It is the only place a
 *  session's REASON for producing nothing is ever written down, and 160 characters cut the L2
 *  certification's one live agent run off mid-word at "…blocked by the approv". */
const AGENT_SUMMARY_CHARS = 400;

/**
 * The dimensions the repo's LATEST scan could not observe at all, as a set.
 *
 * Lazy import for the same reason `loadPair` and `dispatchedPractices` are: the read module reaches
 * for the db client and the lane's unit tests mock the `@/lib/db` barrel without it. A failed read is
 * an EMPTY set, never "assume blind" — refusing to arm work on a guess would be the opposite mistake.
 */
async function latestUnmeasurableDims(org: string, repo: string): Promise<ReadonlySet<string>> {
  try {
    const { getLatestUnmeasurableDims } = await import("@/lib/db/scans-read");
    return new Set(await getLatestUnmeasurableDims(org, repo));
  } catch {
    return new Set<string>();
  }
}

/**
 * Is this repo GREEN — every measured dimension at or above FOLLOW_UP_BELOW on its latest scan?
 *
 * Lazy import for the same reason `latestUnmeasurableDims` above is. A failed read is NOT green,
 * which lands the batch on the untouched gaps-only path: the reservation spends a lane's slots on
 * optional work, so an absence of evidence must never be enough to open it.
 */
async function latestRepoIsGreen(org: string, repo: string, unmeasurable: ReadonlySet<string>): Promise<boolean> {
  try {
    const { getLatestRepoDimScores } = await import("@/lib/db/org-insights-green");
    return isReservationGreen(repo, await getLatestRepoDimScores(org, repo), [...unmeasurable]);
  } catch {
    return false;
  }
}

/** The repo's open follow-ups, biggest projected gain first — the batch the next cycle works. */
export async function openBatch(
  org: string,
  repo: string,
  limit: number = BATCH_SIZE,
  /** `includeDeferred` is for a CURATED batch: a human naming an id outranks a machine's deferral.
   *  `reserveCraft: false` turns the green reservation off, which the curated read needs: it asks
   *  for the WHOLE open list (limit 500) so a named id ranked 7th survives the filter, and capping
   *  gaps at two there would silently drop most of what the operator picked. */
  opts: { includeDeferred?: boolean; reserveCraft?: boolean } = {},
): Promise<FollowUpItem[]> {
  const backlog = await getOrgBacklog(org, null, new Date(), null);
  if (!backlog) return [];
  // ITEMS A PREVIOUS LANE PARKED. An agent that skipped an item and said why has told us something a
  // rescan cannot: re-offering it next cycle spends a session to be told the same thing again. The
  // read is org- AND repo-scoped, and it changes nothing on the Recommendation row — every other
  // surface still shows the item as open, because it is.
  const deferred = opts.includeDeferred
    ? new Set<string>()
    : await getActiveDeferrals(org, repo).catch(() => new Set<string>());
  // DIMENSIONS THE LAST SCAN COULD NOT SEE. Same reason the deferral read above exists: an item the
  // loop cannot verify is an item it will grind forever. A worktree rescan observes no GitHub-side
  // platform fold, so on a repo with nothing to carry, D2/D3/D4 read at their file-scan floor no
  // matter what the agent builds — and the coverage guarantee used to mint a fresh follow-up for them
  // on every scan. Four campaign runs, eight lanes, every one on D4, and both repos' overalls flat.
  // Skipping them here is also what lets the CRAFT ladder be reachable at all: `openBatch` otherwise
  // always found a gap, and craft engages only when a repo has none left.
  const unmeasurable = await latestUnmeasurableDims(org, repo);
  // Ordered by the PRACTICE gap the assessment rated highest, then by projected points as the
  // tiebreak — not by points first. A loop that chases the biggest number chases whatever the
  // detector prices highest, which is the shortest path to the score rather than to the practice
  // (docs/SCORING-VALIDITY.md); impact is the model's judgment of what matters.
  const rank: Record<string, number> = { high: 0, medium: 1, low: 2 };
  const gaps = backlog.byOwner
    .flatMap((g) => g.items)
    .filter(
      (it) =>
        it.repo === repo &&
        it.status === "open" &&
        !deferred.has(it.id) &&
        !(it.dimId && unmeasurable.has(it.dimId)),
    )
    .sort((a, b) => (rank[a.impact] ?? 1) - (rank[b.impact] ?? 1) || (b.projectedPoints ?? 0) - (a.projectedPoints ?? 0))
    .slice(0, Math.max(1, limit))
    .map((it) => ({
      id: it.id,
      repo: it.repo,
      title: it.title,
      dimId: it.dimId,
      dimLabel: it.dimLabel,
      impact: it.impact,
      effort: it.effort,
      rationale: it.rationale,
      explore: it.explore,
      projectedPoints: it.projectedPoints,
    }));
  if (gaps.length === 0) return craftBatch(org, repo, limit, deferred);
  // THE GREEN RESERVATION (see lane-reservation.ts for the campaign evidence).
  //
  // GAPS STILL OUTRANK CRAFT — they come first and they win the top slots — but on a GREEN repo they
  // no longer take the whole lane. r12 reached the ladder only when a repo had zero open gaps, and
  // twelve campaign runs on two green repositories show that never happens: every rescan's roadmap
  // raises one or two fresh entries, so the batch is perpetually a one-item `backlog` lane and the
  // ladder — five well-formed rungs per repo, sitting in the recommendations table — never gets a
  // turn.
  //
  // A NON-GREEN REPO IS UNCHANGED, byte-identical to before: a repo with a real hole gets no craft
  // budget at all. So is a green repo with no rungs left, and so is the curated read, which asks for
  // the whole open list rather than a lane-sized batch.
  if (opts.reserveCraft === false) return gaps;
  if (!(await latestRepoIsGreen(org, repo, unmeasurable))) return gaps;
  // THE RESERVATION IS A PROPORTION, not a count. A fixed two gap slots against a variable batch is
  // two different reservations wearing one number — on a batch of ten it would hand eight slots to the
  // ladder. `gapSlotsAtGreen` keeps the 2/3 split at five and scales it, always leaving at least one
  // slot on each side of any batch of two or more.
  const reserved = Math.max(0, Math.max(1, limit) - gapSlotsAtGreen(Math.max(1, limit)));
  const rungs = reserved > 0 ? await craftBatch(org, repo, reserved, deferred) : [];
  return reserveCraftSlots(gaps, rungs, limit);
}

/**
 * THE CRAFT FALLBACK — what `openBatch` returns once a repo has no open gaps left.
 *
 * This is the whole point of r12. Before it, `openBatch` returned `[]` at green, the engine logged
 * "No open follow-ups left for this repo", every lane closed, and a repository that had done
 * everything the rubric asks was handed silence. The work must never end: above the band the next
 * thing is always a rung, and the rungs are already sitting in the recommendations table.
 *
 * RANKED BY AXIS COVERAGE FIRST, the model's impact second. "Fewest built on this axis" is the
 * ordering because craft is unbounded in every direction at once: a repository that has shipped four
 * performance rungs and nothing on robustness gains far more from its first robustness rung than
 * from its fifth performance one. Impact breaks ties within an axis; an item whose axis the model
 * omitted sorts last, since nothing can be said about its coverage. Deterministic throughout — the
 * curation screen and the engine compute the same order.
 *
 * Nothing here reads or writes a score. A craft item carries `projectedPoints: null` by construction
 * and the ledger it is ranked against feeds no number outside this file and the prompt.
 */
async function craftBatch(
  org: string,
  repo: string,
  limit: number,
  deferred: ReadonlySet<string>,
): Promise<FollowUpItem[]> {
  const [items, ledger] = await Promise.all([
    getCraftItems(org, repo, 200).catch(() => [] as FollowUpItem[]),
    getCraftLedger(org, repo).catch(() => ({ total: 0, byAxis: emptyAxisTally(), unaxised: 0 })),
  ]);
  const open = items.filter((it) => !deferred.has(it.id));
  if (open.length === 0) return [];
  const order = axesByCoverage(ledger.byAxis);
  const axisRank = new Map(order.map((a, i) => [a, i]));
  // An axis-less item sorts after every real axis, never among them.
  const noAxis = order.length;
  const rank: Record<string, number> = { high: 0, medium: 1, low: 2 };
  return [...open]
    .sort(
      (a, b) =>
        (a.craftAxis ? (axisRank.get(a.craftAxis) ?? noAxis) : noAxis) -
          (b.craftAxis ? (axisRank.get(b.craftAxis) ?? noAxis) : noAxis) ||
        (rank[a.impact] ?? 1) - (rank[b.impact] ?? 1),
    )
    .slice(0, Math.max(1, limit));
}

/**
 * Scan a worktree from disk and persist it under the org.
 *
 * `onStage` forwards the scan's own progress stages (fetch → compose) so a long rescan reads as
 * something happening rather than a stuck "rescanning" pill — the same stage vocabulary the fleet
 * SSE now emits (src/app/api/org/scan/route.ts).
 */
export async function rescanWorktree(args: {
  org: string;
  repo: string;
  dir: string;
  branch: string;
  onStage: (stage: string) => void;
}): Promise<{ scanId: string | null; closedIds: string[]; claimedIds: string[] }> {
  // THE PLATFORM FOLD, CARRIED. D2/D3/D4 are credited partly for tooling that is installed rather
  // than committed (review/CI/coverage Apps posting check suites, default-branch Actions health —
  // src/lib/analyze/platform-signals.ts), and none of it is visible from a worktree. Scoring those
  // three dimensions at their file-scan floor here was not a rounding difference: `green` demands L5
  // on every dimension, so the loop could drive forever against a ceiling it created and rendered
  // nowhere. The last GitHub-side scan of this repo recorded what the fold was worth; it is replayed
  // with its own provenance and age on every evidence line, and when there is none the report says
  // the dimensions were NOT MEASURABLE rather than reporting the floor as a measurement.
  //
  // Best-effort: a lookup failure must never fail the rescan. It degrades to `unavailable`, which is
  // the honest reading of "we could not establish what GitHub sees".
  const carried = await getLatestPlatformSignals(args.org, args.repo).catch(() => null);
  const report = await scanRepository(args.repo, {
    orgSlug: args.org,
    source: new LocalFsSource(args.dir),
    scopeCaveat: carried
      ? `Scanned from the loop worktree (branch ${args.branch}) — GitHub-side signals are carried from scan ${carried.scanId}, not observed here.`
      : `Scanned from the loop worktree (branch ${args.branch}) — GitHub-side signals are not included.`,
    noAmbientToken: true,
    platformSignalsUnobservable: true,
    carriedPlatformSignals: carried,
    onProgress: (p) => {
      if (p.stage !== "done") args.onStage(p.stage);
    },
  });
  const persisted = await persistScanReport(report, { orgSlug: args.org });
  // THE CLAIM AND THE VERDICT ARE TWO SETS (UAT `PRIYA-L1-702`, 2026-08-30).
  //
  // `report.resolvedFollowUpIds` is `parseResolvedIds` over the branch's commit messages — and on the
  // agent lane the lane itself wrote those trailers, from the session's own `RESOLVED:` lines.
  // `lane-commit.ts`'s header says so outright: "the trailer is a CLAIM, never a verdict". Returning
  // it as `closedIds` made the loop its own verifier: the cockpit rendered 46 rows as "closed by the
  // rescan" while `/api/org/backlog` — which reads the ledger the movement witness actually writes —
  // reported `done: 0`. Same rescan, two meanings of "closed".
  //
  // So the two are returned separately, and `closedIds` is now the ADJUDICATED set: the ids
  // `persistScanReport` ran through `decideInProgress` — restatement, the dimension's own movement,
  // and `attributeDelta` over the two engines — and ruled `done`. A claim the rescan could not
  // confirm comes back in `claimedIds` and NOWHERE else, so nothing downstream can print it as a
  // verdict.
  return {
    scanId: persisted?.scanId ?? null,
    closedIds: persisted?.closedFollowUpIds ?? [],
    claimedIds: report.resolvedFollowUpIds ?? [],
  };
}

/**
 * The lane's deliverable headlines, or null when the pair could not be read. Never throws.
 * The verdict is `attributeDelivered` over the same pair the ledger renders, so a lane that
 * committed nothing, straddled the mock floor or moved inside the noise band gets its closes and
 * its install as headlines and NO movement line — the prose refuses exactly where the number does.
 */
async function laneDeliverables(
  deps: LaneDeps,
  args: {
    org: string;
    repo: string;
    kind: LoopLaneKind;
    beforeScanId: string | null;
    afterScanId: string | null;
    commits: number;
    closedIds: string[];
    agentClaims: readonly AgentClaim[];
    practiceName: string | null;
  },
): Promise<LaneDeliverable[] | null> {
  try {
    const pair = await deps.loadPair({ orgSlug: args.org, repoFullName: args.repo, beforeScanId: args.beforeScanId, afterScanId: args.afterScanId });
    const before = pair?.before ?? null;
    const after = pair?.after ?? null;
    const derived = deriveLaneDeliverables({
      kind: args.kind,
      agentClaims: args.agentClaims,
      diff: before && after ? diffScans(before, after) : null,
      before,
      after,
      verdict: attributeDelivered(before, after, args.commits),
      practiceName: args.practiceName,
      closedFollowUpIds: args.closedIds,
      // Half of the TOTALITY test: a lane that committed must produce a headline even when nothing
      // it closed can be resolved to a title. See lane-deliverables.ts §4.
      commits: args.commits,
    });
    if (derived.length === 0) return derived;
    return await deps.summarize(derived, args.org).catch(() => derived);
  } catch {
    return null;
  }
}

/**
 * Drive one lane to completion. Never throws: every outcome — including a failed agent session or a
 * failed rescan — is lane data, so one bad repo can't take the run's other lanes with it.
 */
export async function runLane(input: LaneRunInput): Promise<LaneRunResult> {
  const deps: LaneDeps = { ...defaultLaneDeps, ...input.deps };
  const { runId, org, repo, cycle, worktree } = input;
  // Under an `ab` policy the arm's model is part of the lane's IDENTITY: two arms of one repo in one
  // cycle are two rows, and without the discriminator the second would resolve to the first's row and
  // overwrite its branch, its cost and its result. A `single` run passes neither and behaves exactly
  // as it always did.
  const lane = await upsertLane({
    runId,
    repoFullName: repo,
    cycle,
    ...(input.abPairKey ? { model: input.agent?.model ?? null, abPairKey: input.abPairKey } : {}),
  });
  const laneId = lane?.id ?? null;
  // CLAIM → RUN → ADJUDICATE, with RELEASE on every path where the adjudication never happened.
  // The claim (open → in_progress below) is what lets the rescan's feedback attach to these rows —
  // and a claim nobody adjudicates is a ZOMBIE: still in_progress, so openBatch never re-dispatches
  // it, and the movement-gated rescan rule keeps it open. Drive #1 (2026-08-26) died 35s in and left
  // ten of eleven backlog rows claimed; the next drive found "no open follow-ups" on a fleet with
  // 350 points of debt. Every failure path below releases; only a lane whose RESCAN ran keeps them.
  let claimedIds: string[] = [];
  const releaseClaims = async (why: string): Promise<void> => {
    // `releaseFollowups` releases only rows THIS actor still holds, which is strictly safer than the
    // unconditional per-id reopen it replaces: a lane whose cleanup arrives late can no longer
    // un-claim a row a different worker has since picked up.
    if (claimedIds.length > 0) await releaseFollowups(claimedIds, why, LANE_ACTOR).catch(() => 0);
    claimedIds = [];
  };
  const fail = async (message: string): Promise<LaneRunResult> => {
    await releaseClaims(`loop cycle ${cycle} failed before its rescan could adjudicate (${firstLine(message)})`);
    if (laneId) {
      await appendLaneLog(laneId, message);
      await updateLane(laneId, { phase: "error", error: message, stage: null, endedAt: new Date() });
    }
    return { laneId, progressed: false, commits: 0, closed: 0, error: message };
  };
  if (!laneId) return { laneId: null, progressed: false, commits: 0, closed: 0, error: "No database — a loop run cannot be recorded." };

  try {
    const beforeScanId = await getLatestScanIdForRepo(org, repo);
    await updateLane(laneId, {
      phase: "dispatching",
      branch: worktree.branch,
      beforeScanId,
      startedAt: new Date(),
      error: null,
    });

    // WHAT THE WORKTREE WAS GIVEN TO RUN WITH, said once. A git worktree carries tracked files only,
    // so `createLoopWorktree` links the paired checkout's dependency caches in (`worktree-deps.ts`) —
    // without them the repository's own `npm run test:unit` cannot start and the degradation guard
    // reports `baseline-red` on a pristine tree. `takeDepNotes` DRAINS: the linking happened once, when
    // the worktree was made, so the first cycle to open it reports it and cycle 2 does not repeat it.
    for (const note of takeDepNotes(worktree)) await appendLaneLog(laneId, note);

    const kind: LoopLaneKind = input.kind ?? "backlog";
    // The agent's structured account of this cycle, if it wrote one. Declared here because the
    // adjudication below (after the rescan) needs it and the agent branch produces it.
    let report: LaneReport | null = null;
    /** The playbooks the brief actually quoted, with the dimension each covers — the only ones a
     *  verified close may stamp as adopted. */
    let briefedPlaybooks: { id: string; dimId: string }[] = [];
    const before = (await runGit(worktree.dir, ["rev-parse", "HEAD"])).stdout.trim();
    // The agent's own `RESOLVED: <id> - <what changed>` lines, kept for the deliverable headlines.
    let agentClaims: AgentClaim[] = [];

    // A FOUNDATION lane has no batch: the repo's backlog is not what it is answering. Every other
    // kind picks one, and a curated batch NAMES its rows, so the pick has to span the repo's whole
    // open list — a curated id ranked 7th by projected points is still a curated id, and filtering
    // the top-5 slice would silently drop it. An uncurated cycle takes the top BATCH_SIZE, exactly as
    // the autopilot did.
    let batch: FollowUpItem[] = [];
    if (kind !== "foundation") {
      const curated = input.batch;
      // A CURATED batch overrides deferrals: naming an id by hand is an explicit human instruction,
      // and a machine's "I skipped this three cycles ago" must not silently drop it from the run the
      // operator just armed. An uncurated cycle honours the deferral.
      // A curated read asks for the WHOLE open list and turns the green reservation off with it:
      // the cap exists to size a LANE, and applying it to a 500-item curation read would drop most
      // of what the operator named. An uncurated cycle takes the reserved batch.
      const picked = await deps.openBatch(
        org,
        repo,
        curated ? 500 : batchSizeOf(input.batchSize),
        curated ? { includeDeferred: true, reserveCraft: false } : { includeDeferred: false },
      );
      batch = curated ? picked.filter((it) => curated.includes(it.id)) : picked;
      if (curated) {
        const parked = await getActiveDeferrals(org, repo).catch(() => new Set<string>());
        const overridden = batch.filter((it) => parked.has(it.id));
        if (overridden.length > 0) {
          await appendLaneLog(
            laneId,
            `${overridden.length} curated item(s) were deferred by an earlier lane and are being dispatched anyway — a named pick outranks a deferral.`,
          );
        }
      }
      if (batch.length === 0) {
        // Reached only when the repo has NEITHER an open gap NOR an unbuilt craft rung — `openBatch`
        // falls back to the ladder before it returns empty. That is a scan that produced no craft
        // entries at all, not "this repo is finished".
        await appendLaneLog(laneId, "No open follow-ups and no craft rungs left for this repo — nothing to dispatch.");
        await updateLane(laneId, { phase: "done", stage: null, endedAt: new Date() });
        return { laneId, progressed: false, commits: 0, closed: 0, error: null };
      }
      // The batch's DOMINANT dimension, stamped at dispatch (moonshot #26). `ImprovementPr.dimId` is
      // non-nullable, so a lane that later becomes a PR needs one — and it has to be decided here,
      // from the batch that was actually dispatched, rather than inferred afterwards from whatever
      // the rescan happened to move. Honest null when the batch spans no dimension: a lane with no
      // dominant dimension simply cannot open a PR, and inventing one would put a real row in the
      // ledger under a dimension nobody chose.
      await updateLane(laneId, { batchIds: batch.map((b) => b.id), dimId: dominantDimId(batch) });

      // The hand-off claim, so the rescan's trailer/restatement feedback applies to these rows
      // (scans-persist only resolves IN-PROGRESS rows — an unclaimed row is nobody's promise).
      //
      // ONE CALL, and it can now come back PARTIAL. A remote agent holding two of the five rows means
      // this lane works the other three and says which it could not take, rather than stealing them
      // and having two workers write into the same gap. `leaseMs: null` is deliberate: the local
      // engine already has a release on every failure path, so an expiry clock would be a second,
      // slower mechanism for a job this lane finishes or fails loudly.
      const claim = await claimFollowups({
        org,
        ids: batch.map((it) => it.id),
        actor: LANE_ACTOR,
        executor: "local",
        leaseMs: null,
        note: `Loop cycle ${cycle}: dispatched to a local agent on ${worktree.branch}`,
      }).catch(() => null);
      claimedIds = claim?.claimed.map((c) => c.id) ?? [];
      const lost = claim?.refused.filter((r) => r.reason === "held") ?? [];
      if (lost.length > 0) {
        await appendLaneLog(
          laneId,
          `${lost.length} of ${batch.length} item(s) are already held by another worker — this lane works the rest.`,
        );
        // The batch shrinks to what was actually won, so the brief, the dispatch and the per-item
        // adjudication all describe the same rows. A prompt naming work somebody else holds is a
        // prompt asking for a merge conflict.
        const won = new Set(claimedIds);
        batch = batch.filter((it) => won.has(it.id));
        // Re-stamp what was actually dispatched. The row's `batchIds` is what the outcome ledger
        // adjudicates against, so leaving the pre-claim list there would file a stranger's row under
        // this lane's verdict.
        await updateLane(laneId, { batchIds: batch.map((b) => b.id), dimId: dominantDimId(batch) });
      }
      if (batch.length === 0) {
        await appendLaneLog(laneId, "Every follow-up in this batch is held by another worker — nothing to dispatch.");
        await updateLane(laneId, { phase: "done", stage: null, endedAt: new Date() });
        return { laneId, progressed: false, commits: 0, closed: 0, error: null };
      }
    }

    // The DETERMINISTIC kinds, named explicitly rather than as "not backlog". A `craft` lane is an
    // AGENT lane — same session, different batch and brief — so a `kind !== "backlog"` test would
    // have silently routed it into the file installer and installed a practice starter instead.
    if (kind === "foundation" || kind === "practice") {
      // The deterministic half of the loop. No agent session is spent: the files come out of the same
      // generator the cloud draft-PR doors use, and the rescan below adjudicates the result exactly as
      // it does an agent's commits — an install that changes nothing measurable closes nothing.
      await appendLaneLog(laneId, `Cycle ${cycle}: ${kind} lane — ${input.reason ?? "installing generated files."}`);
      const res = await deps.install({
        dir: worktree.dir,
        org,
        repo,
        kind,
        practiceId: input.practiceId ?? null,
        resolvesId: batch[0]?.id ?? null,
      });
      await appendLaneLog(laneId, res.summary);
      if (!res.ok) return fail(res.summary);
      if (!res.committed) {
        // Nothing landed, so there is nothing for a rescan to attribute. Release rather than leave a
        // claim nobody will adjudicate — the same contract every other non-rescanning path here has.
        await releaseClaims(`loop cycle ${cycle}'s ${kind} lane wrote nothing`);
        await updateLane(laneId, { phase: "done", stage: null, endedAt: new Date() });
        return { laneId, progressed: false, commits: 0, closed: 0, error: null };
      }
    } else {
      await appendLaneLog(laneId, `Cycle ${cycle}: dispatching ${batch.length} follow-up(s) to a local agent…`);
      // THE ORGANIZATION'S OWN STANDARD, assembled for exactly this batch's dimensions and recorded
      // on the row as provenance before the session starts. Every remediation vendor applies generic
      // best practice; the differentiator is that this one applies the org's versioned playbooks, the
      // pattern mined from its own repositories, its procedural memory and its registry skills — and
      // says so in words where it has none of those, rather than leaving an empty heading the agent
      // would read as "there is no standard here".
      const briefInput = await deps
        .loadBrief(org, repo, [...new Set(batch.map((b) => b.dimId).filter(Boolean))])
        .catch(() => null);
      const brief = briefInput ? buildLaneBrief(briefInput) : null;
      if (brief && briefInput) {
        await updateLane(laneId, { brief: brief.provenance });
        await appendLaneLog(laneId, `Brief: ${briefSummaryLine(brief.provenance)}`);
        // Only the playbooks that were RENDERED (a trimmed-away one was never seen), keyed by the
        // dimension each covers so a close can be matched to the playbook that could have caused it.
        const rendered = new Set(brief.provenance.sections.find((s) => s.kind === "playbook")?.refs ?? []);
        briefedPlaybooks = briefInput.playbooks
          .filter((p) => rendered.has(`${p.id}@${p.version}`))
          .map((p) => ({ id: p.id, dimId: p.dimId }));
      }
      await excludeLaneReport(worktree.dir);
      // ── A: THE BASELINE, measured BEFORE the session touches anything (and recalled from cache on
      // every cycle after the first — a later cycle's HEAD already carries this loop's own commits, so
      // re-measuring would ask a different question). This is also what decides whether the brief may
      // promise a safety net at all: the invitation to make a larger change is only honest when a
      // command actually resolved AND actually passed on the pristine tree.
      const guardOn = input.verify?.enabled !== false;
      const verifyMs = verifyTimeoutMsOf(input.verify?.timeoutMs ?? null);
      let baseline: VerifyBaseline = { resolved: null, passed: null, note: null };
      if (guardOn) {
        await updateLane(laneId, { stage: "verifying" });
        baseline = await verifyBaseline(worktree.dir, verifyMs).catch(() => ({ resolved: null, passed: null, note: null }));
        await updateLane(laneId, { stage: null });
        await appendLaneLog(
          laneId,
          baseline.resolved == null
            ? "Degradation guard: this repository declares no check the loop could resolve, so this cycle will be UNVERIFIED — not verified."
            : baseline.passed
              ? `Degradation guard armed: \`${baseline.resolved.command}\` (from ${baseline.resolved.source}) passes on the untouched worktree.`
              : `Degradation guard: \`${baseline.resolved.command}\` (from ${baseline.resolved.source}) already FAILS on this repository before the session — the agent is not blamed for that, and this cycle proceeds.`,
        );
      }
      // ── THE RED BASELINE BECOMES THIS LANE'S LEAD ITEM.
      //
      // A red baseline is the one condition under which everything else this lane does is
      // unverifiable: the guard has nothing green to compare against, so a regression committed here
      // cannot be caught and a fix cannot be confirmed. The most valuable work available is therefore
      // making the repository's own check pass again, and the brief says so FIRST — above the armed
      // batch, which still rides along.
      //
      // The measurement above is what decides it, not the history: a repository repaired since the
      // last lane gets NO lead however red that history is. The history supplies only the ATTEMPT
      // COUNT, which is what turns a silent retry into "attempt 4, and it is still failing".
      const priorLanes = await deps.priorBaselines(org, repo).catch((): BaselineLaneRow[] => []);
      const redLead = leadWithRedBaseline({
        repo,
        prior: priorLanes,
        current: !guardOn || baseline.resolved == null ? "unmeasured" : baseline.passed === false ? "red" : "green",
        command: baseline.resolved?.command ?? null,
        note: baseline.note,
      });
      if (redLead) {
        await appendLaneLog(
          laneId,
          `Red baseline — this brief LEADS with restoring \`${redLead.command ?? "the repository's own check"}\` (attempt ${redLead.attempt}); the armed batch still rides along, second.`,
        );
        // The operator's copy of the same fact, in the review queue they already read. ONE row per
        // repository, refreshed as the attempt count climbs — see recordRedBaselineLesson.
        await recordRedBaselineLesson(org, repo, redBaselineLesson(repo, redLead)).catch(() => null);
      }
      // THE BRIEF NO LONGER ASKS FOR A COMMIT, because the flags make one impossible: `claude -p
      // --permission-mode acceptEdits` grants file edits and not Bash, and headless `-p` has nobody
      // to answer the prompt `git commit` raises instead (L2-A-01). It asks for the one thing only
      // the session knows — which ids it resolved — and the lane commits below. See lane-commit.ts.
      const prompt =
        buildFixPrompt(batch, {
          org,
          generatedAt: new Date().toISOString().slice(0, 10),
          scanNote: "autopilot cycle",
          commitPolicy: "lane",
          // ONLY when the net is real. A promise of verification on a repo whose baseline is red (or
          // that declares no check) would invite exactly the bold change nothing is going to catch.
          verifyCommand: guardOn && baseline.passed === true ? baseline.resolved?.command ?? null : null,
          // The opposite case, and mutually exclusive with the line above by construction: no net to
          // promise, and a repair that outranks everything in the batch.
          redBaseline: redLead,
        }) +
        `\n\nAUTOPILOT CONTEXT:\n- You are in an isolated worktree on branch \`${worktree.branch}\`. DO NOT run git — this session has no shell permission and every git command will be refused. Leave your changes in the working tree; the Ascent lane commits them for you the moment you exit, with the trailers.\n- NEVER push, never switch branches, never touch remotes.\n- If an item cannot be safely resolved, skip it and say why in your summary.\n\nWHAT COUNTS AS RESOLVED:\n- Understand this codebase first, then implement the change that most raises the level of trust the item describes. Do the WORK, never the detector: a config file for a tool this project does not use, an empty or stub file, or a tool's name in a workflow comment is not a fix — the rescan scores practices that operate, and it verifies before it closes anything.\n- The trailer is a claim, not a verdict. A row closes only when the next scan no longer raises the gap AND its dimension measurably moved; a claim the rescan cannot confirm stays open.\n- On each RESOLVED line, state how a reviewer would tell the practice is real: what runs, when it runs, and what happens when it fails. If you cannot write that sentence honestly, the item is SKIPPED, not resolved.\n` +
        // The org's standard, then the report contract. In that order deliberately: the standard is
        // what the work should look like, and the contract is how the session reports on it.
        (brief ? `\n\nYOUR ORGANIZATION'S STANDARD:\n${brief.text}\n` : "") +
        laneReportContract(batch.map((b) => b.id));
      const result = await deps.runAgent({
        cwd: worktree.dir,
        prompt,
        ...(input.agent?.model ? { model: input.agent.model } : {}),
        ...(input.agent?.effort ? { effort: input.agent.effort } : {}),
        // Conditional for the same reason the two above are: an ABSENT key lets the runner fall back
        // to the deployment's own `ASCENT_AUTOPILOT_TIMEOUT_MS`, which is what every session before
        // this parameter used. Passing an explicit null would say the same thing, but a lane that
        // sends the key on every call is one refactor away from sending a 0.
        ...(input.agent?.timeoutMs ? { timeoutMs: input.agent.timeoutMs } : {}),
      });
      await appendLaneLog(
        laneId,
        `${result.ok ? "Agent finished" : "Agent failed"}: ${firstLine(result.summary, AGENT_SUMMARY_CHARS)}`,
      );
      const armed = new Set(batch.map((b) => b.id));
      agentClaims = parseClaimLines(result.summary).filter((c) => armed.has(c.id));
      // WHAT THE SESSION COST, recorded IMMEDIATELY — before the commit, the rescan or anything else
      // that can fail. A lane that dies three steps from here still carries its cost, which is the
      // half of the ledger that cannot be reconstructed from git afterwards. A FAILED session is
      // recorded too: a failure that burned two dollars is the most important row in the price list.
      await recordAgentCost(laneId, org, repo, result, input);
      // THE AGENT'S OWN ACCOUNT, read before the commit and the rescan so a lane that dies later
      // still carries it. A missing or malformed report is `parsed: false` — which is not the same
      // fact as "it skipped nothing", and the ledger renders the difference.
      report = await deps.readReport(worktree.dir, batch.map((b) => b.id)).catch(() => null);
      if (report) {
        await updateLane(laneId, { report });
        await appendLaneLog(
          laneId,
          report.parsed
            ? `Report: ${report.items.length} item verdict(s), ${report.lessons.length} lesson(s).`
            : "No lane report was written — the agent's per-item verdicts are unknown for this cycle.",
        );
      }
      // ── B: THE RESULT RUN, after the session and BEFORE the commit. Before, because the whole
      // point of the guard is that a rejected cycle leaves no commit and no branch to explain away.
      //
      // Four verdicts, one of which changes the lane's course (see lane-guard.ts):
      //   verified     → proceed, and the row says so.
      //   baseline-red → the repository arrived broken. Proceed, and DO NOT blame the agent.
      //   skipped      → nothing resolvable, or the guard is off. Proceed, and say the lane is
      //                  UNVERIFIED rather than letting silence read as a pass.
      //   rejected     → a pass became a failure. `verifyResult` has already discarded the edits in
      //                  this throwaway worktree; the lane commits nothing, rescans nothing (a rescan
      //                  of a tree nothing landed in would become this repo's latest reading), claims
      //                  nothing, and — because the verdict is persisted — is never landed or PR'd.
      if (guardOn) {
        await updateLane(laneId, { stage: "verifying" });
        const outcome = await verifyResult(worktree.dir, baseline, verifyMs);
        await updateLane(laneId, {
          stage: null,
          verifyVerdict: outcome.verdict,
          verifyCommand: outcome.command,
          verifyNote: outcome.note,
        });
        await appendLaneLog(laneId, outcome.note);
        if (outcome.reject) {
          // The lesson is a STANDING FACT about this repository and this command, so it goes through
          // the same pending-candidate queue every agent lesson does — a human keeps or discards it.
          await recordLoopLessons(org, repo, laneId, [verifyRejectionLesson(repo, outcome)]).catch(() => []);
          // A deliverable too, so the outcome sheet shows the reversal rather than an empty lane. It
          // covers nothing on purpose: no follow-up was closed, and listing the armed ids here would
          // put them in the ledger under a cycle that delivered none of them.
          await updateLane(laneId, {
            deliverables: [
              {
                headline: "Discarded — repository checks regressed",
                dimId: null,
                kind: "noted",
                covers: [],
                evidence: outcome.note,
              },
            ],
          });
          await releaseClaims(`loop cycle ${cycle} was reversed by the degradation guard, so nothing adjudicated the claim`);
          await updateLane(laneId, { phase: "done", commits: 0, stage: null, endedAt: new Date() });
          return { laneId, progressed: false, commits: 0, closed: 0, error: null };
        }
      } else {
        // The operator turned the guard off. Recorded as `skipped` WITH the reason, never left null:
        // null is what a lane written before the guard existed carries, and "we did not check" must
        // not be able to masquerade as "there was nothing to check".
        await updateLane(laneId, {
          verifyVerdict: "skipped",
          verifyCommand: null,
          verifyNote: "Verification SKIPPED: the degradation guard was switched off for this run. This lane's work is UNVERIFIED.",
        });
      }

      // THE LANE COMMITS. The worktree is an isolated scratch checkout nothing else writes to, so
      // whatever is dirty in it is this session's work. A session that DID manage to commit (a future
      // mode with a wider grant) leaves nothing behind and this is a no-op; anything left over is
      // residue and lands in one commit carrying the armed batch's `Ascent-Resolves:` trailers.
      const committed = await deps.commitWork({
        dir: worktree.dir,
        branch: worktree.branch,
        cycle,
        batch,
        summary: result.summary,
      });
      await appendLaneLog(laneId, committed.summary);
    }

    const countRes = await runGit(worktree.dir, ["rev-list", "--count", `${before}..HEAD`]);
    const commits = countRes.ok ? Number(countRes.stdout.trim()) || 0 : 0;
    await appendLaneLog(laneId, `${commits} commit(s) landed this cycle.`);
    // A SESSION THAT WORKED AND DID NOT COMMIT IS NOT A SESSION THAT FOUND NOTHING, and until this
    // was added the lane could not tell them apart: both read "0 commit(s) landed this cycle", and
    // `removeLoopWorktree`'s `--force` then deleted the evidence on its way out. The L2 certification
    // hit exactly this — a real `claude -p` session edited files for 5m46s, could not run `git
    // commit` under `--permission-mode acceptEdits` (headless `-p` has nobody to grant Bash), and the
    // branch that is supposed to BE the deliverable ended up carrying none of it.
    //
    // THE LANE NOW COMMITS THAT WORK (lane-commit.ts), so reaching here dirty means the LANE's own
    // commit failed — a hook, a missing git identity, a locked index. This stays as the fallback,
    // and it is now the last thing standing between a failed commit and a silently deleted worktree.
    if (kind === "backlog" && commits === 0) {
      const dirty = await runGit(worktree.dir, ["status", "--porcelain"]);
      const changed = dirty.ok ? dirty.stdout.split("\n").filter((l) => l.trim()).length : 0;
      if (changed > 0) {
        await appendLaneLog(
          laneId,
          `${changed} change(s) are still uncommitted in the worktree and the lane could not commit them either — that work is NOT on ${worktree.branch} and is discarded with the worktree. Check the commit failure and the agent summary above for the reason.`,
        );
      }
    }

    if (input.shouldStop?.()) {
      await releaseClaims(`loop cycle ${cycle} was stopped before its rescan could adjudicate`);
      await updateLane(laneId, { phase: "done", commits, stage: null, endedAt: new Date() });
      await appendLaneLog(laneId, "Stop requested — winding this lane down before the rescan; the batch is released.");
      return { laneId, progressed: false, commits, closed: 0, error: null };
    }

    // A LANE THAT COMMITTED NOTHING DOES NOT RESCAN. L2-B-01: the L2 run's agent lane lost its work,
    // rescanned the worktree it was about to delete anyway, and that scan became the repository's
    // LATEST reading — so the fleet's greenness, the debt total and the run's own headline
    // `▲+24 ATTRIBUTABLE LIFT` all credited `bare-svc` with a standard that existed nowhere on disk.
    // `attributeScores` rules out an engine swap and model wobble, the two ways a score moves without
    // the repository moving; it has no test for whether the measured state is DURABLE, because until
    // an agent lane could lose its own work nothing could produce a measurement of a state that was
    // about to be discarded. The gate is here, at the source: no commit, no scan, nothing to adopt.
    // (The read side refuses the same pair independently — `laneAttribution` in cockpitDrift.ts —
    // because the rows written before this gate existed are still in the database.)
    if (commits === 0) {
      await releaseClaims(`loop cycle ${cycle} committed nothing, so there was nothing for a rescan to adjudicate`);
      await appendLaneLog(
        laneId,
        "No commits, so no rescan: scanning a worktree that nothing landed in would make it this repository's latest reading and credit the repo with work that does not exist.",
      );
      await updateLane(laneId, { phase: "done", commits, stage: null, endedAt: new Date() });
      return { laneId, progressed: false, commits, closed: 0, error: null };
    }

    await updateLane(laneId, { phase: "rescanning", commits });
    await appendLaneLog(laneId, "Rescanning the worktree from disk…");
    let closedIds: string[] = [];
    // Ids a commit trailer NAMED that the rescan did not close. Kept beside the verdict, never folded
    // into it: this is the number the cockpit used to print as "closed by the rescan".
    let unverifiedClaimIds: string[] = [];
    let afterScanId: string | null = null;
    try {
      const out = await deps.rescan({
        org,
        repo,
        dir: worktree.dir,
        branch: worktree.branch,
        onStage: (stage) => void updateLane(laneId, { stage }),
      });
      closedIds = out.closedIds;
      unverifiedClaimIds = (out.claimedIds ?? []).filter((id) => !out.closedIds.includes(id));
      afterScanId = out.scanId;
    } catch (err) {
      await appendLaneLog(laneId, `Rescan failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (afterScanId == null) {
      // No rescan means no adjudication: the rows would sit in_progress forever, owned by nobody.
      // Releasing risks re-dispatching work that exists unverified on this branch — accepted; a
      // duplicate attempt is recoverable and a zombie claim is not.
      await releaseClaims(`loop cycle ${cycle}'s rescan failed, so nothing adjudicated the claim`);
    } else {
      claimedIds = []; // the rescan adjudicated; the claim is now the scan feedback's to settle
    }
    // The log says which of the two numbers it means. A close here has been through the movement
    // witness; a claim has not, and saying "closed" for it is the laundering this lane no longer does.
    const claimNote = unverifiedClaimIds.length > 0 ? ` ${unverifiedClaimIds.length} more were CLAIMED by a commit trailer and the rescan did not confirm them — they stay open.` : "";
    await appendLaneLog(
      laneId,
      (closedIds.length > 0
        ? `${closedIds.length} follow-up(s) closed by the rescan — the gap is no longer raised and its dimension moved.`
        : "No follow-ups closed this cycle.") + claimNote,
    );
    // WHAT THE LANE DELIVERED, as headlines (lane-deliverables.ts): the agent's claims, the install,
    // and the ATTRIBUTABLE part of the diff — under the same verdict the ledger's number answers to.
    // Best-effort end to end: a failed pair read or a polish that never answers leaves the column
    // null, and the read side derives the same list from what is persisted.
    const deliverables = await laneDeliverables(deps, {
      org,
      repo,
      kind,
      beforeScanId,
      afterScanId,
      commits,
      closedIds,
      agentClaims,
      practiceName: input.practiceId ? input.practiceId.replace(/[-_]+/g, " ") : null,
    });
    await updateLane(laneId, {
      phase: "done",
      commits,
      closedIds,
      afterScanId,
      stage: null,
      endedAt: new Date(),
      ...(deliverables ? { deliverables } : {}),
    });
    if (deliverables && deliverables.length > 0) {
      await appendLaneLog(laneId, `Delivered: ${deliverables.map((d) => d.headline).join(" · ")}`);
    }
    // PER-ITEM OUTCOMES, after the rescan has ruled. The rescan's close wins over any claim; an id
    // the agent said it SKIPPED is parked so the next cycle asks a different question instead of
    // spending another session on the same refusal. Nothing on the Recommendation row changes — a
    // deferral is advisory to `openBatch` alone.
    if (kind === "backlog" && batch.length > 0) {
      await recordLaneOutcomes({
        orgSlug: org,
        runId,
        laneId,
        repoFullName: repo,
        cycle,
        batchIds: batch.map((b) => b.id),
        closedIds,
        report,
      }).catch(() => []);

      // ADOPTION EVIDENCE, on a verified close only. A row the rescan closed on a dimension the
      // brief carried a playbook for is the one case where "this repo now follows that playbook" is
      // supported by something other than hope — the agent read the steps and the verifier saw the
      // dimension move. A close under a playbook the brief never quoted stamps nothing.
      // LESSONS, as CANDIDATES. The loop never writes Org Memory: a lesson is an unattended agent's
      // claim about what this organization should believe, and the brief above reads memory as truth.
      // A human keeps or discards it through the lessons inbox, which promotes through the same
      // memory door the consolidation check lives behind.
      if (report && report.lessons.length > 0) {
        const kept = await recordLoopLessons(org, repo, laneId, report.lessons).catch(() => []);
        if (kept.length > 0) {
          await appendLaneLog(laneId, `${kept.length} lesson candidate(s) recorded for review — nothing was written into memory.`);
        }
      }

      const closedDims = new Set(batch.filter((b) => closedIds.includes(b.id)).map((b) => b.dimId));
      const earned = briefedPlaybooks.filter((p) => closedDims.has(p.dimId)).map((p) => p.id);
      if (earned.length > 0) {
        const stamped = await stampPlaybookApplications(org, repo, earned).catch(() => 0);
        if (stamped > 0) {
          await appendLaneLog(laneId, `${stamped} playbook(s) from this lane's brief recorded as applied — the rescan verified the close.`);
        }
      }
    }
    return { laneId, progressed: commits > 0 || closedIds.length > 0, commits, closed: closedIds.length, error: null };
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
}
