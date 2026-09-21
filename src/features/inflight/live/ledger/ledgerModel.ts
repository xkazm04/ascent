// The ledger's vocabulary — the runner's one-line status, why a plan waits, and the section anchors
// every briefing line links to. Pure: the words are facts about functions, pinned by tests.

// `runner-types.ts` is the contract's DEPENDENCY-FREE module (its header: the ledger imports it in the
// browser), so the branch name is read from it rather than spelled a second time here.
import { RUNNER_BRANCH, type RepoPauseReason, type RunnerPauseReason } from "@/lib/local/runner-types";
import { fmtAgo, fmtIn, shortRepo } from "./ledgerFormat";
import type { DriveEventRecord, DriveStatus, LedgerActiveRun, LoopPlanRecord, RepoRunnerState } from "./ledgerTypes";

export { RUNNER_BRANCH };

/** Section anchors — every briefing line is a door to the section that proves it. */
export const LEDGER_ANCHOR = {
  needsYou: "ledger-needs-you",
  runner: "ledger-runner",
  directions: "ledger-directions",
  chronicle: "ledger-chronicle",
  lessons: "ledger-lessons",
} as const;

export const RUNNER_PAUSE_WORDS: Record<RunnerPauseReason, string> = {
  "spend-ceiling": "the day's spend ceiling was reached",
  "session-limit": "the account hit its session limit",
};

export const REPO_PAUSE_WORDS: Record<RepoPauseReason, string> = {
  "repo-failures": "repeated failed lanes",
  "branch-conflict": "the base would not merge into the runner branch",
  "dependency-install": "dependencies would not install",
  "dry-backoff": "resting after dry runs",
};

const BREAKER_WORDS: Record<string, string> = {
  "spend-ceiling": "spend ceiling",
  "session-limit": "session limit",
  "repo-failures": "repeated failures",
  "branch-conflict": "branch conflict",
  "dependency-install": "dependency install",
};

/** A pause event in a few words — "branch conflict on kp", "spend ceiling". */
export function breakerWords(e: Pick<DriveEventRecord, "event" | "reason" | "repo">): string {
  const why = BREAKER_WORDS[e.reason ?? ""] ?? e.reason ?? "paused";
  return e.event === "repo-paused" && e.repo ? `${why} on ${shortRepo(e.repo)}` : why;
}

/** A repo pause only a person lifts — `dry-backoff` lifts itself on a timer and is not asking. The same
 *  predicate the pulse's needs-you count uses (`needsOperator`, loop-pulse-fold.ts). */
export const needsOperator = (r: RepoRunnerState): boolean => r.paused != null && r.paused !== "dry-backoff";

export type RunnerState = "running" | "paused" | "idle" | "none";

/** The header's one line: what the runner is doing, in the operator's words. */
export function runnerStatus(runner: DriveStatus | null, active: LedgerActiveRun | null, now: string): { state: RunnerState; text: string } {
  if (!runner) return { state: "none", text: "No runner" };
  if (runner.phase === "paused") {
    const why = runner.pausedReason ? RUNNER_PAUSE_WORDS[runner.pausedReason] : "a breaker fired";
    const lifts = fmtIn(runner.pausedUntil, now);
    return { state: "paused", text: `Paused — ${why}${lifts ? `, lifts ${lifts}` : " until you act"}` };
  }
  if (runner.phase === "idle") {
    const wakes = (runner.repoState ?? [])
      .filter((r) => r.paused === "dry-backoff" && r.pausedUntil)
      .map((r) => r.pausedUntil as string)
      .sort()[0];
    const when = fmtIn(wakes, now);
    return { state: "idle", text: when ? `Idle — next repo wakes ${when}` : "Idle — every repo is resting" };
  }
  const since = `Running since ${fmtAgo(runner.startedAt, now)}`;
  if (!active) return { state: "running", text: `${since} · between runs` };
  const num = active.seq != null ? `run #${active.seq}` : "a run";
  return { state: "running", text: `${since} · ${num} · cycle ${active.cycle}/${active.maxCycles}` };
}

/** Why a plan waits for a person, in one clause — the classifier's reason, never a paraphrase of it. */
export function planReason(p: Pick<LoopPlanRecord, "clsReason" | "heldBranch">): string {
  switch (p.clsReason) {
    case "declared-moves":
      return "moves architecture";
    case "unreadable":
      return "the plan could not be read — review the text";
    case "undeclared-moves-in-diff":
      return `the lane made a move its plan did not declare — work held on ${p.heldBranch ?? "no branch (nothing could be kept)"}`;
    case "inside-direction-fence":
      return "inside an approved direction's fence";
    case "no-moves":
      return "no architecture moves";
    default:
      return "waiting for review";
  }
}

/**
 * The command that shows a held plan's parked commits. The lane was cut from the runner branch, so the
 * commits the fence held are exactly those on the held branch and not on `ascent/runner`.
 */
export const heldLogCommand = (heldBranch: string): string => `git log --stat ${RUNNER_BRANCH}..${heldBranch}`;
