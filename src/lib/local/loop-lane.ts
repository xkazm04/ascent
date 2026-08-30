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
import { runClaudeAgent, type AgentRunResult } from "@/lib/local/agent";
import { meter } from "@/lib/llm/meter";
import { buildFixPrompt, type FollowUpItem } from "@/lib/org/followups";
import { getOrgBacklog } from "@/lib/db/org-insights";
import { updateRecommendation } from "@/lib/db/scans-recommendations";
import { getLatestPlatformSignals, persistScanReport } from "@/lib/db";
import { scanRepository } from "@/lib/scan";
import { appendLaneLog, getLatestScanIdForRepo, updateLane, upsertLane } from "@/lib/db/loop-runs";
// The cost source comes from the TYPES module rather than the barrel deliberately: the barrel is
// mocked wholesale by several lane suites (it is the DB seam), and a constant that only exists
// through a mock is a constant those suites have to keep re-declaring.
import { LANE_COST_SOURCE, type LoopLaneKind } from "@/lib/db/loop-runs-types";
import { installInWorktree } from "@/lib/local/lane-install";
import { commitAgentWork } from "@/lib/local/lane-commit";
import { proposeLaneKind } from "@/lib/local/lane-kind";
import type { LoopWorktree } from "@/lib/local/loop-worktree";

export const BATCH_SIZE = 5;

/** The side-effecting primitives a lane drives, injectable so tests never spawn an agent or shell. */
export interface LaneDeps {
  runAgent: typeof runClaudeAgent;
  /** The deterministic install a `foundation` / `practice` lane does instead of calling an agent. */
  install: typeof installInWorktree;
  /** Commits what the agent session left behind — see lane-commit.ts for why the LANE does this. */
  commitWork: typeof commitAgentWork;
  /** Which kind of lane a repo's next cycle should be — read from the paired working copy. */
  laneKind: typeof proposeLaneKind;
  /** Scan a worktree from disk and persist it. Returns the new scan id + the ids its trailers closed. */
  rescan: (args: {
    org: string;
    repo: string;
    dir: string;
    branch: string;
    onStage: (stage: string) => void;
  }) => Promise<{ scanId: string | null; closedIds: string[] }>;
  /** The repo's open follow-ups, biggest projected gain first, capped at `limit`. */
  openBatch: (org: string, repo: string, limit?: number) => Promise<FollowUpItem[]>;
}

export const defaultLaneDeps: LaneDeps = {
  runAgent: runClaudeAgent,
  install: installInWorktree,
  commitWork: commitAgentWork,
  laneKind: proposeLaneKind,
  rescan: rescanWorktree,
  openBatch,
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
  agent?: { model?: string | null; effort?: string | null };
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

const firstLine = (s: string, max = 160): string => s.split("\n").find((l) => l.trim())?.slice(0, max) ?? "";

/** The agent's own first line gets more room than the rest of the log. It is the only place a
 *  session's REASON for producing nothing is ever written down, and 160 characters cut the L2
 *  certification's one live agent run off mid-word at "…blocked by the approv". */
const AGENT_SUMMARY_CHARS = 400;

/** The repo's open follow-ups, biggest projected gain first — the batch the next cycle works. */
export async function openBatch(org: string, repo: string, limit: number = BATCH_SIZE): Promise<FollowUpItem[]> {
  const backlog = await getOrgBacklog(org, null, new Date(), null);
  if (!backlog) return [];
  // Ordered by the PRACTICE gap the assessment rated highest, then by projected points as the
  // tiebreak — not by points first. A loop that chases the biggest number chases whatever the
  // detector prices highest, which is the shortest path to the score rather than to the practice
  // (docs/SCORING-VALIDITY.md); impact is the model's judgment of what matters.
  const rank: Record<string, number> = { high: 0, medium: 1, low: 2 };
  return backlog.byOwner
    .flatMap((g) => g.items)
    .filter((it) => it.repo === repo && it.status === "open")
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
}): Promise<{ scanId: string | null; closedIds: string[] }> {
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
  return { scanId: persisted?.scanId ?? null, closedIds: report.resolvedFollowUpIds ?? [] };
}

/** A cost for the lane log. `null` prints "cost unknown" — never `$0.00`, which is a claim. */
function fmtCostMicros(micros: number | null): string {
  if (micros == null) return "cost unknown";
  const cents = micros / 1_000_000;
  return cents < 100 ? `${cents.toFixed(2)}¢` : `$${(cents / 100).toFixed(2)}`;
}

/**
 * Stamp what the session cost onto the lane, then mirror it to the unified meter.
 *
 * THE ONE-SOURCE RULE lives here: `costSource` is stamped `"envelope"` and the figure is the CLI's
 * own `total_cost_usd` for THIS session. `agentSessionId` is recorded so the row can be JOINED to an
 * OTLP `AgentSession` for inspection, and that is all — an `AgentSession` is the export of sessions a
 * developer ran, a different population by a different path, and adding its `costCents` here would
 * double-count the same tokens under the guise of a better figure.
 *
 * The meter call is FIRE-AND-FORGET by construction (`meter()` returns void and swallows everything),
 * carries the caller-owned idempotency key `loop-lane:<laneId>` so a retried write cannot double
 * count, and hands over the cost rather than letting the meter re-price it: for a subscription-auth
 * CLI session the envelope is authoritative and a token-times-rate estimate is not.
 */
async function recordAgentCost(
  laneId: string,
  orgSlug: string,
  repo: string,
  result: AgentRunResult,
  input: LaneRunInput,
): Promise<void> {
  const model = result.model ?? input.agent?.model ?? null;
  const costMicros = result.costMicros ?? null;
  await updateLane(laneId, {
    model,
    costSource: LANE_COST_SOURCE,
    costMicros,
    inputTokens: result.inputTokens ?? null,
    outputTokens: result.outputTokens ?? null,
    cacheReadTokens: result.cacheReadTokens ?? null,
    turns: result.turns ?? null,
    agentDurationMs: result.durationMs ?? null,
    agentSessionId: result.sessionId ?? null,
    ...(input.abPairKey ? { abPairKey: input.abPairKey } : {}),
  }).catch(() => null);
  await appendLaneLog(
    laneId,
    `Agent: ${model ?? "model unknown"} · ${result.turns ?? "?"} turns · ${fmtCostMicros(costMicros)}${
      result.durationMs != null ? ` · ${Math.round(result.durationMs / 1000)}s` : ""
    }`,
  );
  // `costMicros` on the lane is MICRO-CENTS; the meter's is USD micros. Divide by 100 rather than
  // handing over a figure a hundred times too large — the two units are deliberately different
  // because a lane needs sub-cent resolution and a usage ledger sums whole calls.
  try {
    meterLane(laneId, orgSlug, repo, model, costMicros, result);
  } catch (err) {
    // `meter()` is documented as unable to throw, and this lane does not take that on trust: an
    // observability call must never be the reason a remediation lane failed. The lane log is where it
    // is said out loud, so a silently unmetered run is still visible to the operator.
    await appendLaneLog(laneId, `Usage meter declined this lane: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** The meter half of the record, split out so the try/catch above wraps one thing. */
function meterLane(
  laneId: string,
  orgSlug: string,
  repo: string,
  model: string | null,
  costMicros: number | null,
  result: AgentRunResult,
): void {
  meter({
    lane: "local",
    orgSlug,
    refId: laneId,
    idemKey: `loop-lane:${laneId}`,
    provider: "claude-cli",
    model: model ?? "unknown",
    repoFullName: repo,
    status: result.ok ? "success" : "error",
    latencyMs: result.durationMs ?? undefined,
    costMicros: costMicros == null ? null : Math.round(costMicros / 100),
    ...(result.inputTokens != null || result.outputTokens != null || result.cacheReadTokens != null
      ? {
          usage: {
            inputTokens: result.inputTokens ?? 0,
            outputTokens: result.outputTokens ?? 0,
            cacheReadTokens: result.cacheReadTokens ?? undefined,
          },
        }
      : {}),
  });
}

/**
 * Drive one lane to completion. Never throws: every outcome — including a failed agent session or a
 * failed rescan — is lane data, so one bad repo can't take the run's other lanes with it.
 */
export async function runLane(input: LaneRunInput): Promise<LaneRunResult> {
  const deps: LaneDeps = { ...defaultLaneDeps, ...input.deps };
  const { runId, org, repo, cycle, worktree } = input;
  const lane = await upsertLane({ runId, repoFullName: repo, cycle });
  const laneId = lane?.id ?? null;
  // CLAIM → RUN → ADJUDICATE, with RELEASE on every path where the adjudication never happened.
  // The claim (open → in_progress below) is what lets the rescan's feedback attach to these rows —
  // and a claim nobody adjudicates is a ZOMBIE: still in_progress, so openBatch never re-dispatches
  // it, and the movement-gated rescan rule keeps it open. Drive #1 (2026-08-26) died 35s in and left
  // ten of eleven backlog rows claimed; the next drive found "no open follow-ups" on a fleet with
  // 350 points of debt. Every failure path below releases; only a lane whose RESCAN ran keeps them.
  let claimedIds: string[] = [];
  const releaseClaims = async (why: string): Promise<void> => {
    for (const id of claimedIds) {
      await updateRecommendation(id, { status: "open" }, { actor: "autopilot", note: `Released: ${why}` }).catch(() => null);
    }
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

    const kind: LoopLaneKind = input.kind ?? "backlog";
    const before = (await runGit(worktree.dir, ["rev-parse", "HEAD"])).stdout.trim();

    // A FOUNDATION lane has no batch: the repo's backlog is not what it is answering. Every other
    // kind picks one, and a curated batch NAMES its rows, so the pick has to span the repo's whole
    // open list — a curated id ranked 7th by projected points is still a curated id, and filtering
    // the top-5 slice would silently drop it. An uncurated cycle takes the top BATCH_SIZE, exactly as
    // the autopilot did.
    let batch: FollowUpItem[] = [];
    if (kind !== "foundation") {
      const curated = input.batch;
      const picked = await deps.openBatch(org, repo, curated ? 500 : BATCH_SIZE);
      batch = curated ? picked.filter((it) => curated.includes(it.id)) : picked;
      if (batch.length === 0) {
        await appendLaneLog(laneId, "No open follow-ups left for this repo — nothing to dispatch.");
        await updateLane(laneId, { phase: "done", stage: null, endedAt: new Date() });
        return { laneId, progressed: false, commits: 0, closed: 0, error: null };
      }
      await updateLane(laneId, { batchIds: batch.map((b) => b.id) });

      // The hand-off claim, so the rescan's trailer/restatement feedback applies to these rows
      // (scans-persist only resolves IN-PROGRESS rows — an unclaimed row is nobody's promise).
      for (const it of batch) {
        const claimed = await updateRecommendation(
          it.id,
          { status: "in_progress" },
          { actor: "autopilot", note: `Loop cycle ${cycle}: dispatched to a local agent on ${worktree.branch}` },
        ).catch(() => null);
        if (claimed) claimedIds.push(it.id);
      }
    }

    if (kind !== "backlog") {
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
      // THE BRIEF NO LONGER ASKS FOR A COMMIT, because the flags make one impossible: `claude -p
      // --permission-mode acceptEdits` grants file edits and not Bash, and headless `-p` has nobody
      // to answer the prompt `git commit` raises instead (L2-A-01). It asks for the one thing only
      // the session knows — which ids it resolved — and the lane commits below. See lane-commit.ts.
      const prompt =
        buildFixPrompt(batch, { org, generatedAt: new Date().toISOString().slice(0, 10), scanNote: "autopilot cycle", commitPolicy: "lane" }) +
        `\n\nAUTOPILOT CONTEXT:\n- You are in an isolated worktree on branch \`${worktree.branch}\`. DO NOT run git — this session has no shell permission and every git command will be refused. Leave your changes in the working tree; the Ascent lane commits them for you the moment you exit, with the trailers.\n- NEVER push, never switch branches, never touch remotes.\n- If an item cannot be safely resolved, skip it and say why in your summary.\n\nWHAT COUNTS AS RESOLVED:\n- Understand this codebase first, then implement the change that most raises the level of trust the item describes. Do the WORK, never the detector: a config file for a tool this project does not use, an empty or stub file, or a tool's name in a workflow comment is not a fix — the rescan scores practices that operate, and it verifies before it closes anything.\n- The trailer is a claim, not a verdict. A row closes only when the next scan no longer raises the gap AND its dimension measurably moved; a claim the rescan cannot confirm stays open.\n- On each RESOLVED line, state how a reviewer would tell the practice is real: what runs, when it runs, and what happens when it fails. If you cannot write that sentence honestly, the item is SKIPPED, not resolved.\n`;
      const result = await deps.runAgent({
        cwd: worktree.dir,
        prompt,
        ...(input.agent?.model ? { model: input.agent.model } : {}),
        ...(input.agent?.effort ? { effort: input.agent.effort } : {}),
      });
      await appendLaneLog(
        laneId,
        `${result.ok ? "Agent finished" : "Agent failed"}: ${firstLine(result.summary, AGENT_SUMMARY_CHARS)}`,
      );
      // WHAT THE SESSION COST, recorded IMMEDIATELY — before the commit, the rescan or anything else
      // that can fail. A lane that dies three steps from here still carries its cost, which is the
      // half of the ledger that cannot be reconstructed from git afterwards. A FAILED session is
      // recorded too: a failure that burned two dollars is the most important row in the price list.
      await recordAgentCost(laneId, org, repo, result, input);
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
    await appendLaneLog(
      laneId,
      closedIds.length > 0 ? `${closedIds.length} follow-up(s) closed by trailer` : "No follow-ups closed this cycle.",
    );
    await updateLane(laneId, {
      phase: "done",
      commits,
      closedIds,
      afterScanId,
      stage: null,
      endedAt: new Date(),
    });
    return { laneId, progressed: commits > 0 || closedIds.length > 0, commits, closed: closedIds.length, error: null };
  } catch (err) {
    return fail(err instanceof Error ? err.message : String(err));
  }
}
