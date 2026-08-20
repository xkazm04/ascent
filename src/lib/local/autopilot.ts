// LOCAL MODE autopilot — the war room's dispatch loop (self-hosted deployments only, and only with
// ASCENT_AUTOPILOT=1). One repo at a time, in cycles:
//
//   pick the repo's top open follow-ups → mark them in-progress (the same claim the ledger's
//   hand-off makes) → spawn one headless claude session in an ISOLATED WORKTREE with the batch's
//   fix prompt → count what it committed → rescan the worktree from disk (LocalFsSource) so the
//   `Ascent-Resolves:` trailers close their rows → repeat while progress is being made.
//
// GUARDRAILS, each load-bearing:
//   - Worktree isolation. `git worktree add -b ascent/autopilot-<stamp> <tmp> HEAD` — the agent
//     never touches the operator's checkout, their branch, or their uncommitted work. The branch
//     survives the run (that IS the deliverable: review it, merge it); the worktree dir is removed.
//   - Never pushes. Nothing here talks to a remote; the loop proposes, the human merges.
//   - Bounded. maxCycles caps the loop; a cycle with NO commits and NO closed rows ends it early
//     (an agent that stopped making progress will not start again by being re-asked).
//   - One job per org. The registry refuses a second start — two agents in one fleet's worktrees
//     racing the same backlog would double-claim rows and interleave logs into noise.
//
// STATE IS IN-MEMORY by design (a Map in this module). A self-hosted deployment is one long-lived
// node process, and the job's durable OUTPUT is git commits + persisted scans + closed rows — all of
// which survive a restart. The transient ticker/log does not need to.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runGit } from "@/lib/local/git";
import { LocalFsSource } from "@/lib/local/source";
import { runClaudeAgent } from "@/lib/local/agent";
import { verifyLocalPath } from "@/lib/local/pairing";
import { buildFixPrompt, type FollowUpItem } from "@/lib/org/followups";
import { getOrgBacklog } from "@/lib/db/org-insights";
import { updateRecommendation } from "@/lib/db/scans-recommendations";
import { persistScanReport } from "@/lib/db";
import { scanRepository } from "@/lib/scan";

const BATCH_SIZE = 5;
export const MAX_CYCLES_CAP = 5;

export type AutopilotPhase = "starting" | "dispatching" | "rescanning" | "done" | "stopped" | "error";

export interface AutopilotJob {
  org: string;
  repo: string;
  branch: string | null;
  phase: AutopilotPhase;
  cycle: number;
  maxCycles: number;
  startedAt: string;
  endedAt: string | null;
  /** Rolling human-readable log, newest last (bounded). */
  log: string[];
  closedIds: string[];
  commits: number;
  error: string | null;
  /** Cooperative stop flag — checked between phases, never mid-agent-session. */
  stopRequested: boolean;
}

const jobs = new Map<string, AutopilotJob>();

export function getAutopilotJob(org: string): AutopilotJob | null {
  return jobs.get(org) ?? null;
}

export function requestAutopilotStop(org: string): boolean {
  const job = jobs.get(org);
  if (!job || job.endedAt) return false;
  job.stopRequested = true;
  push(job, "Stop requested — finishing the current phase, then winding down.");
  return true;
}

function push(job: AutopilotJob, line: string): void {
  job.log.push(`${new Date().toISOString().slice(11, 19)} ${line}`);
  if (job.log.length > 200) job.log.splice(0, job.log.length - 200);
}

/** The repo's open follow-ups, biggest projected gain first — the batch the next cycle works. */
async function openBatch(org: string, repo: string): Promise<FollowUpItem[]> {
  const backlog = await getOrgBacklog(org, null, new Date(), null);
  if (!backlog) return [];
  const items = backlog.byOwner
    .flatMap((g) => g.items)
    .filter((it) => it.repo === repo && it.status === "open")
    .sort((a, b) => (b.projectedPoints ?? 0) - (a.projectedPoints ?? 0))
    .slice(0, BATCH_SIZE);
  return items.map((it) => ({
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

/** Start a job (throws with the reason when it cannot). The loop itself runs detached — the route
 *  answers immediately and the war-room band polls getAutopilotJob. */
export async function startAutopilot(opts: { org: string; repo: string; path: string; maxCycles: number }): Promise<AutopilotJob> {
  const existing = jobs.get(opts.org);
  if (existing && !existing.endedAt) throw new Error(`An autopilot run is already active for ${opts.org} (${existing.repo}).`);

  const check = await verifyLocalPath(opts.path, opts.repo);
  if (!check.ok) throw new Error(`Pairing broken: ${check.error}`);

  const job: AutopilotJob = {
    org: opts.org,
    repo: opts.repo,
    branch: null,
    phase: "starting",
    cycle: 0,
    maxCycles: Math.max(1, Math.min(MAX_CYCLES_CAP, opts.maxCycles)),
    startedAt: new Date().toISOString(),
    endedAt: null,
    log: [],
    closedIds: [],
    commits: 0,
    error: null,
    stopRequested: false,
  };
  jobs.set(opts.org, job);
  push(job, `Autopilot armed for ${opts.repo} — up to ${job.maxCycles} cycle(s), batch of ${BATCH_SIZE}.`);
  void runLoop(job, opts.path).catch((err) => {
    job.phase = "error";
    job.error = err instanceof Error ? err.message : String(err);
    job.endedAt = new Date().toISOString();
    push(job, `Fatal: ${job.error}`);
  });
  return job;
}

async function runLoop(job: AutopilotJob, pairedPath: string): Promise<void> {
  // One worktree for the whole run: cycles build on each other's commits, exactly like a human
  // working a branch — and one branch is one reviewable deliverable.
  const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 12);
  const branch = `ascent/autopilot-${stamp}`;
  const wtDir = await mkdtemp(join(tmpdir(), "ascent-autopilot-"));
  const added = await runGit(pairedPath, ["worktree", "add", "-b", branch, wtDir, "HEAD"]);
  if (!added.ok) throw new Error(`Could not create the worktree: ${added.stderr || added.stdout}`);
  job.branch = branch;
  push(job, `Worktree ready on branch ${branch} (from HEAD; your checkout is untouched).`);

  try {
    while (job.cycle < job.maxCycles && !job.stopRequested) {
      job.cycle += 1;
      const batch = await openBatch(job.org, job.repo);
      if (batch.length === 0) {
        push(job, "No open follow-ups left for this repo — nothing to dispatch.");
        break;
      }

      // The hand-off claim, so the rescan's trailer/restatement feedback applies to these rows
      // (scans-persist only resolves IN-PROGRESS rows — an unclaimed row is nobody's promise).
      for (const it of batch) {
        await updateRecommendation(it.id, { status: "in_progress" }, { actor: "autopilot", note: `Autopilot cycle ${job.cycle}: dispatched to a local agent on ${branch}` }).catch(() => null);
      }

      job.phase = "dispatching";
      push(job, `Cycle ${job.cycle}: dispatching ${batch.length} follow-up(s) to a local agent…`);
      const before = (await runGit(wtDir, ["rev-parse", "HEAD"])).stdout.trim();
      const prompt =
        buildFixPrompt(batch, { org: job.org, generatedAt: new Date().toISOString().slice(0, 10), scanNote: "autopilot cycle" }) +
        `\n\nAUTOPILOT CONTEXT:\n- You are in an isolated worktree on branch \`${branch}\` — commit directly to it, one commit per resolved item, each carrying its trailer.\n- NEVER push, never switch branches, never touch remotes.\n- If an item cannot be safely resolved, skip it and say why in your summary.\n`;
      const result = await runClaudeAgent({ cwd: wtDir, prompt });
      push(job, result.ok ? `Agent finished: ${firstLine(result.summary)}` : `Agent failed: ${firstLine(result.summary)}`);

      const countRes = await runGit(wtDir, ["rev-list", "--count", `${before}..HEAD`]);
      const newCommits = countRes.ok ? Number(countRes.stdout.trim()) || 0 : 0;
      job.commits += newCommits;
      push(job, `${newCommits} commit(s) landed this cycle.`);

      job.phase = "rescanning";
      push(job, "Rescanning the worktree from disk…");
      const closed = await rescanWorktree(job, wtDir);
      job.closedIds.push(...closed);
      push(job, closed.length > 0 ? `${closed.length} follow-up(s) closed by trailer ✓` : "No follow-ups closed this cycle.");

      if (newCommits === 0 && closed.length === 0) {
        push(job, "No progress this cycle — stopping early rather than re-asking an agent that stalled.");
        break;
      }
    }
    job.phase = job.stopRequested ? "stopped" : "done";
    push(job, `Run complete: ${job.commits} commit(s) on ${branch}, ${job.closedIds.length} follow-up(s) closed. Review and merge the branch from your own checkout.`);
  } finally {
    job.endedAt = new Date().toISOString();
    // The BRANCH is the deliverable and survives; only the temp worktree dir is removed. --force:
    // the agent may have left untracked scratch files, which must not strand a temp dir forever.
    await runGit(pairedPath, ["worktree", "remove", "--force", wtDir]).catch(() => null);
    await rm(wtDir, { recursive: true, force: true }).catch(() => null);
  }
}

async function rescanWorktree(job: AutopilotJob, wtDir: string): Promise<string[]> {
  try {
    const report = await scanRepository(job.repo, {
      orgSlug: job.org,
      source: new LocalFsSource(wtDir),
      scopeCaveat: `Scanned from the autopilot worktree (branch ${job.branch}) — GitHub-side signals are not included.`,
      noAmbientToken: true,
    });
    await persistScanReport(report, { orgSlug: job.org });
    return report.resolvedFollowUpIds ?? [];
  } catch (err) {
    push(job, `Rescan failed: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

const firstLine = (s: string): string => s.split("\n").find((l) => l.trim())?.slice(0, 160) ?? "";
