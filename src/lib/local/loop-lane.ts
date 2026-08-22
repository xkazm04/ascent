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

import { runGit } from "@/lib/local/git";
import { LocalFsSource } from "@/lib/local/source";
import { runClaudeAgent } from "@/lib/local/agent";
import { buildFixPrompt, type FollowUpItem } from "@/lib/org/followups";
import { getOrgBacklog } from "@/lib/db/org-insights";
import { updateRecommendation } from "@/lib/db/scans-recommendations";
import { persistScanReport } from "@/lib/db";
import { scanRepository } from "@/lib/scan";
import { appendLaneLog, getLatestScanIdForRepo, updateLane, upsertLane } from "@/lib/db/loop-runs";
import type { LoopWorktree } from "@/lib/local/loop-worktree";

export const BATCH_SIZE = 5;

/** The two side-effecting primitives a lane drives, injectable so tests never spawn an agent. */
export interface LaneDeps {
  runAgent: typeof runClaudeAgent;
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
  deps?: Partial<LaneDeps>;
  /** Cooperative stop, checked between phases — never mid-agent-session. */
  shouldStop?: () => boolean;
}

export interface LaneRunResult {
  laneId: string | null;
  /** True when the lane committed something or closed a row — the signal the run keeps cycling on. */
  progressed: boolean;
  commits: number;
  closed: number;
  error: string | null;
}

const firstLine = (s: string): string => s.split("\n").find((l) => l.trim())?.slice(0, 160) ?? "";

/** The repo's open follow-ups, biggest projected gain first — the batch the next cycle works. */
export async function openBatch(org: string, repo: string, limit: number = BATCH_SIZE): Promise<FollowUpItem[]> {
  const backlog = await getOrgBacklog(org, null, new Date(), null);
  if (!backlog) return [];
  return backlog.byOwner
    .flatMap((g) => g.items)
    .filter((it) => it.repo === repo && it.status === "open")
    .sort((a, b) => (b.projectedPoints ?? 0) - (a.projectedPoints ?? 0))
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
  const report = await scanRepository(args.repo, {
    orgSlug: args.org,
    source: new LocalFsSource(args.dir),
    scopeCaveat: `Scanned from the loop worktree (branch ${args.branch}) — GitHub-side signals are not included.`,
    noAmbientToken: true,
    onProgress: (p) => {
      if (p.stage !== "done") args.onStage(p.stage);
    },
  });
  const persisted = await persistScanReport(report, { orgSlug: args.org });
  return { scanId: persisted?.scanId ?? null, closedIds: report.resolvedFollowUpIds ?? [] };
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
  const fail = async (message: string): Promise<LaneRunResult> => {
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

    // A curated batch NAMES its rows, so the pick has to span the repo's whole open list — a curated
    // id ranked 7th by projected points is still a curated id, and filtering the top-5 slice would
    // silently drop it. An uncurated cycle takes the top BATCH_SIZE, exactly as the autopilot did.
    const curated = input.batch;
    const picked = await deps.openBatch(org, repo, curated ? 500 : BATCH_SIZE);
    const batch = curated ? picked.filter((it) => curated.includes(it.id)) : picked;
    if (batch.length === 0) {
      await appendLaneLog(laneId, "No open follow-ups left for this repo — nothing to dispatch.");
      await updateLane(laneId, { phase: "done", stage: null, endedAt: new Date() });
      return { laneId, progressed: false, commits: 0, closed: 0, error: null };
    }
    await updateLane(laneId, { batchIds: batch.map((b) => b.id) });

    // The hand-off claim, so the rescan's trailer/restatement feedback applies to these rows
    // (scans-persist only resolves IN-PROGRESS rows — an unclaimed row is nobody's promise).
    for (const it of batch) {
      await updateRecommendation(
        it.id,
        { status: "in_progress" },
        { actor: "autopilot", note: `Loop cycle ${cycle}: dispatched to a local agent on ${worktree.branch}` },
      ).catch(() => null);
    }

    await appendLaneLog(laneId, `Cycle ${cycle}: dispatching ${batch.length} follow-up(s) to a local agent…`);
    const before = (await runGit(worktree.dir, ["rev-parse", "HEAD"])).stdout.trim();
    const prompt =
      buildFixPrompt(batch, { org, generatedAt: new Date().toISOString().slice(0, 10), scanNote: "autopilot cycle" }) +
      `\n\nAUTOPILOT CONTEXT:\n- You are in an isolated worktree on branch \`${worktree.branch}\` — commit directly to it, one commit per resolved item, each carrying its trailer.\n- NEVER push, never switch branches, never touch remotes.\n- If an item cannot be safely resolved, skip it and say why in your summary.\n`;
    const result = await deps.runAgent({ cwd: worktree.dir, prompt });
    await appendLaneLog(laneId, result.ok ? `Agent finished: ${firstLine(result.summary)}` : `Agent failed: ${firstLine(result.summary)}`);

    const countRes = await runGit(worktree.dir, ["rev-list", "--count", `${before}..HEAD`]);
    const commits = countRes.ok ? Number(countRes.stdout.trim()) || 0 : 0;
    await appendLaneLog(laneId, `${commits} commit(s) landed this cycle.`);

    if (input.shouldStop?.()) {
      await updateLane(laneId, { phase: "done", commits, stage: null, endedAt: new Date() });
      await appendLaneLog(laneId, "Stop requested — winding this lane down before the rescan.");
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
