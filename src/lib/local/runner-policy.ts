// THE STANDING RUNNER'S POLICY — pure, so "what runs next" is a fact about a function rather than
// about a database, a clock or an agent (spark theater-upgrade, 2026-09-18; WP2).
//
// The bounded drive's policy (`nextDriveStep`) has three honest ways to STOP. The runner has none of
// them: it never stops on green (a green repo's lanes climb its craft ladder), never on dry, never on
// a run cap. What it has instead is a set of ways to WAIT, each with a reason and a time:
//
//   • a runner-wide breaker (spend ceiling, session limit) — nothing runs until it lifts;
//   • a per-repo pause — the dry backoff (1 h → 4 h → 12 h, the last repeats), or a breaker only the
//     operator lifts (repo-failures, branch-conflict, dependency-install);
//   • idle — every repo is waiting; the runner sleeps until the EARLIEST timed wake.
//
// PROGRESS IS A VERIFIED CLOSE (a lane's `closedIds`, which the rescan adjudicated), not debt. Debt is
// the bounded drive's verifier because it has a target; the runner has no target, and a repo that has
// cleared the band still earns lanes for as long as its craft ladder produces closes.

import {
  DRY_BACKOFF_MS,
  REPO_FAILURE_STREAK,
  type RepoPauseReason,
  type RepoRunnerState,
  type RunnerPauseReason,
} from "@/lib/local/runner-types";

export const freshRepoState = (repo: string, baseBranch: string | null = null): RepoRunnerState => ({
  repo,
  baseBranch,
  paused: null,
  pausedUntil: null,
  note: null,
  failureStreak: 0,
  dryStreak: 0,
  lastMergeInSha: null,
  lastLandedSha: null,
  aheadOfBase: null,
});

/** One entry per repo in scope, in scope order — keeping what is already known about each. */
export function reconcileRepoState(repos: readonly string[], existing: readonly RepoRunnerState[]): RepoRunnerState[] {
  const byRepo = new Map(existing.map((s) => [s.repo, s]));
  return repos.map((repo) => ({ ...freshRepoState(repo), ...(byRepo.get(repo) ?? {}), repo }));
}

const ms = (iso: string | null): number | null => (iso == null ? null : Date.parse(iso));

/** May this repo get a lane now? Unpaused, or its TIMED pause has elapsed. A pause with no
 *  `pausedUntil` is the operator's to lift and never elapses on its own. */
export function isRepoRunnable(s: RepoRunnerState, now: Date): boolean {
  if (s.paused == null) return true;
  const until = ms(s.pausedUntil);
  return until != null && until <= now.getTime();
}

export type RunnerStep =
  | { action: "stop" }
  | { action: "pause"; reason: RunnerPauseReason; until: string | null }
  | { action: "idle"; until: string | null }
  | { action: "run"; repos: string[] };

export interface RunnerStepInput {
  stopRequested: boolean;
  /** The runner-wide breaker in force, if any. */
  pausedReason: RunnerPauseReason | null;
  pausedUntil: string | null;
  repos: readonly string[];
  repoState: readonly RepoRunnerState[];
  now: Date;
}

/**
 * What the driver does next. Order is the contract: a stop wins over everything (the operator's word
 * outranks any timer); a runner-wide breaker wins over every repo (they share the account and the
 * spend); then the repos that may run. When none may, `idle` names the earliest timed wake — or null
 * when every repo waits on the operator, in which case the runner waits too, and says so.
 */
export function planRunnerStep(input: RunnerStepInput): RunnerStep {
  if (input.stopRequested) return { action: "stop" };
  const now = input.now.getTime();
  if (input.pausedReason) {
    const until = ms(input.pausedUntil);
    if (until == null || until > now) return { action: "pause", reason: input.pausedReason, until: input.pausedUntil };
  }
  const byRepo = new Map(input.repoState.map((s) => [s.repo, s]));
  const runnable = input.repos.filter((r) => isRepoRunnable(byRepo.get(r) ?? freshRepoState(r), input.now));
  if (runnable.length > 0) return { action: "run", repos: runnable };
  let earliest: number | null = null;
  for (const r of input.repos) {
    const until = ms(byRepo.get(r)?.pausedUntil ?? null);
    if (until != null && (earliest == null || until < earliest)) earliest = until;
  }
  return { action: "idle", until: earliest == null ? null : new Date(earliest).toISOString() };
}

/** Clear every TIMED pause that has elapsed. Returns the repos it woke, so the driver can say so. */
export function wakeRepos(states: RepoRunnerState[], now: Date): string[] {
  const woke: string[] = [];
  for (const s of states) {
    if (s.paused != null && s.pausedUntil != null && isRepoRunnable(s, now)) {
      s.paused = null;
      s.pausedUntil = null;
      s.note = null;
      woke.push(s.repo);
    }
  }
  return woke;
}

/** Pause one repo. `until` null = only the operator lifts it. */
export function pauseRepo(s: RepoRunnerState, reason: RepoPauseReason, until: string | null, note: string): void {
  s.paused = reason;
  s.pausedUntil = until;
  s.note = note;
}

/** The operator's "resume this repo": clears the pause, and a fresh failure streak goes with it —
 *  otherwise one more failure re-pauses a repo the operator just decided to give another chance. The
 *  DRY streak is kept: it is history, and a repo that is still dry backs off longer, as it should. */
export function liftRepoPause(s: RepoRunnerState): boolean {
  if (s.paused == null) return false;
  s.paused = null;
  s.pausedUntil = null;
  s.note = null;
  s.failureStreak = 0;
  return true;
}

/** The dry backoff for the Nth consecutive dry run (1-based): 1 h, 4 h, 12 h, 12 h, … */
export function dryBackoffMs(dryStreak: number): number {
  const i = Math.min(Math.max(dryStreak, 1), DRY_BACKOFF_MS.length) - 1;
  return DRY_BACKOFF_MS[i]!;
}

/** What one run did for one repo, folded from its lanes. */
export interface RepoRunOutcome {
  lanes: number;
  /** Lanes that ended `error` or were guard-`rejected`. */
  failed: number;
  /** Lanes whose branch was delivered into a branch the next lane builds on (`landedAt`). */
  landed: number;
  /** Rows the rescan adjudicated closed — the runner's measure of progress. */
  verifiedCloses: number;
  /** The first failure's text, for the pause note. */
  lastError: string | null;
}

/** The lane fields the runner reads after a run — a projection of `LoopLaneRecord`. */
export interface RunnerLaneView {
  repoFullName: string;
  phase: string;
  error: string | null;
  log: string[];
  closedIds: string[];
  verifyVerdict: string | null;
  landedAt: string | null;
  commits: number;
}

export function summarizeRunLanes(lanes: readonly RunnerLaneView[]): Map<string, RepoRunOutcome> {
  const out = new Map<string, RepoRunOutcome>();
  for (const lane of lanes) {
    const o = out.get(lane.repoFullName) ?? { lanes: 0, failed: 0, landed: 0, verifiedCloses: 0, lastError: null };
    o.lanes += 1;
    if (lane.phase === "error" || lane.verifyVerdict === "rejected") {
      o.failed += 1;
      o.lastError ??= lane.error ?? (lane.verifyVerdict === "rejected" ? "the degradation guard rejected the lane" : null);
    }
    if (lane.landedAt) o.landed += 1;
    o.verifiedCloses += lane.closedIds.length;
    out.set(lane.repoFullName, o);
  }
  return out;
}

const hours = (n: number): string => `${Math.round(n / 3_600_000)} h`;

/**
 * Fold one run's outcome into a repo's state: the failure streak, the dry streak, and whichever pause
 * they earn. `repo-failures` outranks the dry backoff — a repo that keeps failing is the operator's
 * problem, not a timer's. Mutates `s` and returns the pause it applied (or null).
 */
export function applyRunOutcome(s: RepoRunnerState, outcome: RepoRunOutcome | undefined, now: Date): RepoPauseReason | null {
  const o = outcome ?? { lanes: 0, failed: 0, landed: 0, verifiedCloses: 0, lastError: null };
  if (o.landed > 0) s.failureStreak = 0;
  else if (o.lanes > 0 && o.failed === o.lanes) s.failureStreak += 1;
  s.dryStreak = o.verifiedCloses > 0 ? 0 : s.dryStreak + 1;
  if (s.failureStreak >= REPO_FAILURE_STREAK) {
    const why = o.lastError ? ` Last: ${o.lastError.slice(0, 200)}` : "";
    pauseRepo(s, "repo-failures", null, `${s.failureStreak} runs in a row where every lane failed or was rejected by the guard.${why}`);
    return "repo-failures";
  }
  if (o.verifiedCloses === 0) {
    const wait = dryBackoffMs(s.dryStreak);
    pauseRepo(
      s,
      "dry-backoff",
      new Date(now.getTime() + wait).toISOString(),
      `${s.dryStreak} run(s) in a row with no verified close — backing off ${hours(wait)}.`,
    );
    return "dry-backoff";
  }
  // A verified close ends a dry spell outright — including a backoff the repo was woken early from.
  if (s.paused === "dry-backoff") {
    s.paused = null;
    s.pausedUntil = null;
    s.note = null;
  }
  return null;
}
