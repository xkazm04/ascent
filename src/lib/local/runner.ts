// THE STANDING RUNNER'S DRIVER — a continuous drive, pulled until the operator stops it
// (spark theater-upgrade, 2026-09-18; WP2).
//
// The bounded drive (`drive.ts`) is a rope: at most N runs, stopping on green, dry or the ceiling. This
// is the other shape. It never stops on its own; it WAITS, and every wait has a named reason:
//
//   run     the repos that may run get one loop run, armed from the runner branch (`baseRef`), planned,
//           verified, and delivered with `runner` — each verified lane fast-forwards `ascent/runner`;
//   pause   a runner-wide breaker (spend ceiling, session limit) — nothing runs until it lifts;
//   idle    every repo waits (dry backoff or an operator-held pause) — sleep until the earliest wake.
//
// Before each run, per repo: make sure the runner branch exists, then MERGE the base into it (never
// rebase — lane SHAs are on rows). A conflict pauses that repo with the files named. After each run:
// fold the lanes into each repo's streaks (runner-policy.ts), and classify every agent failure for the
// account's session limit (runner-breakers.ts).
//
// EVERY SEAM IS INJECTED (`RunnerDeps`): the engine, the db, git and the clock. The production wiring
// is `runner-control.ts`; the tests drive this loop with fakes and a fake clock, which is how "it runs
// past green, past dry, waits on a busy slot, pauses on each breaker and stops when told" is proven
// without an agent, a repository or a real hour.

import type { StartLoopRunInput } from "@/lib/local/loop-engine";
import { DRIVE_POLL_MS, type DriveEventRecord, type DriveMeasurement, type DriveRunRecord, type DriveStatus } from "@/lib/local/drive-types";
import { RUNNER_BRANCH, type RepoPauseReason, type RepoRunnerState } from "@/lib/local/runner-types";
import type { MergeInResult, RunnerBranchResult } from "@/lib/local/runner-branch";
import { localMidnight, sessionLimitBreaker, sessionLimitTexts, spendCeilingBreaker, type RunnerBreakerHit } from "@/lib/local/runner-breakers";
import {
  applyRunOutcome,
  freshRepoState,
  pauseRepo,
  planRunnerStep,
  reconcileRepoState,
  summarizeRunLanes,
  wakeRepos,
  type RunnerLaneView,
} from "@/lib/local/runner-policy";
import { dialRunInput } from "@/lib/local/drive-dials";
import { reposNamedIn } from "@/lib/local/pairing-health";

/** How often a waiting runner wakes to re-read its state (a stop, a resumed repo) and stamp its beat. */
export const RUNNER_BEAT_MS = 60_000;
/** How often a runner waiting for the org's one run slot asks again. */
export const RUNNER_SLOT_POLL_MS = 30_000;
/** The ledger keeps this many runs and this many events; older runs fold into `runsBefore`. */
export const RUNNER_LEDGER_RUNS = 200;
export const RUNNER_LEDGER_EVENTS = 100;
/** `startLoopRun`'s refusal when the org already has an active run — the one refusal that means WAIT. */
const RUN_SLOT_BUSY = /already active/i;

export interface RunnerDeps {
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
  save: (st: DriveStatus) => Promise<void>;
  measure: (org: string, repos: readonly string[]) => Promise<DriveMeasurement | null>;
  /** Micro-cents the org's lanes cost since `since`; null = no reading. */
  spendSince: (org: string, since: Date) => Promise<number | null>;
  pairedPath: (org: string, repo: string) => Promise<string | null>;
  resolveBase: (pairedPath: string) => Promise<string | null>;
  ensureBranch: (pairedPath: string, base: string) => Promise<RunnerBranchResult>;
  mergeIn: (pairedPath: string, base: string) => Promise<MergeInResult>;
  aheadCount: (pairedPath: string, base: string) => Promise<number | null>;
  runnerTip: (pairedPath: string) => Promise<string | null>;
  startRun: (input: StartLoopRunInput) => Promise<{ id: string }>;
  /** True once the run has ended — or no longer exists, which cannot be waited on either. */
  runEnded: (runId: string) => Promise<boolean>;
  stopRun: (runId: string) => Promise<unknown>;
  listLanes: (runId: string) => Promise<RunnerLaneView[]>;
}

interface Ctx {
  st: DriveStatus;
  actor: string | null;
  deps: RunnerDeps;
  savedAt: number;
  /** Where each repo of the current run lives, from its pre-run preparation. */
  paths: Map<string, { path: string; base: string }>;
}

const iso = (d: Date): string => d.toISOString();
const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/** The loop-run input the runner arms EVERY run with. The dials ride along; the runner's own posture
 *  (plan first, verify on, deliver to the runner branch, lanes cut from it) is applied AFTER them, so
 *  no dial can switch the guard off under an unattended runner. */
export function runnerRunInput(st: DriveStatus, repos: string[], actor: string | null): StartLoopRunInput {
  return {
    org: st.org,
    repos,
    maxCycles: st.maxCycles,
    concurrency: st.concurrency,
    model: st.model ?? null,
    effort: st.effort ?? null,
    ...dialRunInput(st.dials),
    delivery: "runner",
    driveId: st.id,
    planMode: "on",
    baseRef: RUNNER_BRANCH,
    verifyMode: "on",
    runnerLane: { autoKeepLessons: true, installDeps: true },
    actor,
  };
}

function event(cx: Ctx, e: Omit<DriveEventRecord, "at" | "repo" | "reason" | "until"> & Partial<DriveEventRecord>): void {
  const rec: DriveEventRecord = { at: iso(cx.deps.now()), repo: null, reason: null, until: null, ...e };
  const events = (cx.st.events ??= []);
  events.push(rec);
  if (events.length > RUNNER_LEDGER_EVENTS) events.splice(0, events.length - RUNNER_LEDGER_EVENTS);
}

/** Stamp the runner's heartbeat; mirror it to the row at most once a beat (or now, when forced). */
async function beat(cx: Ctx, force = false): Promise<void> {
  const now = cx.deps.now();
  cx.st.lastBeatAt = iso(now);
  if (force || now.getTime() - cx.savedAt >= RUNNER_BEAT_MS) {
    cx.savedAt = now.getTime();
    await cx.deps.save(cx.st);
  }
}

function stateOf(st: DriveStatus, repo: string): RepoRunnerState {
  const all = (st.repoState ??= []);
  let s = all.find((r) => r.repo === repo);
  if (!s) all.push((s = freshRepoState(repo)));
  return s;
}

function holdRepo(cx: Ctx, s: RepoRunnerState, reason: RepoPauseReason, note: string): void {
  pauseRepo(s, reason, null, note);
  event(cx, { event: "repo-paused", repo: s.repo, reason, note });
}

function pauseRunner(cx: Ctx, hit: RunnerBreakerHit): void {
  cx.st.pausedReason = hit.reason;
  cx.st.pausedUntil = hit.until;
  cx.st.phase = "paused";
  event(cx, { event: "paused", reason: hit.reason, until: hit.until, note: hit.note });
}

function liftElapsedPause(cx: Ctx, now: Date): void {
  const { st } = cx;
  if (!st.pausedReason || !st.pausedUntil || Date.parse(st.pausedUntil) > now.getTime()) return;
  event(cx, { event: "resumed", reason: st.pausedReason, note: `The ${st.pausedReason} pause lifted — the runner continues.` });
  st.pausedReason = null;
  st.pausedUntil = null;
  st.phase = "running";
}

/** Sleep one beat (or less, when the wake is sooner) in a waiting phase, then let the loop re-plan. */
async function waitIn(cx: Ctx, phase: "paused" | "idle", until: string | null): Promise<void> {
  if (cx.st.phase !== phase) {
    cx.st.phase = phase;
    await cx.deps.save(cx.st);
  }
  const left = until == null ? RUNNER_BEAT_MS : Date.parse(until) - cx.deps.now().getTime();
  await cx.deps.sleep(Math.max(1_000, Math.min(RUNNER_BEAT_MS, left)));
  await beat(cx);
}

/** Ensure + merge-in for each planned repo. A repo that cannot be prepared is paused, with why. */
async function prepareRepos(cx: Ctx, planned: readonly string[]): Promise<string[]> {
  const { st, deps } = cx;
  const ready: string[] = [];
  cx.paths.clear();
  for (const repo of planned) {
    const s = stateOf(st, repo);
    const path = await deps.pairedPath(st.org, repo).catch(() => null);
    if (!path) {
      holdRepo(cx, s, "repo-failures", `${repo} is no longer paired with a local path — pair it again on Admin → Pairing, then resume the repo.`);
      continue;
    }
    const base = s.baseBranch ?? (await deps.resolveBase(path).catch(() => null));
    if (!base) {
      holdRepo(cx, s, "branch-conflict", `Could not tell which branch ${RUNNER_BRANCH} merges in from: the checkout has no origin/HEAD and is not on a branch.`);
      continue;
    }
    s.baseBranch = base;
    const ensured = await deps.ensureBranch(path, base).catch((err: unknown): RunnerBranchResult => ({ ok: false, note: message(err) }));
    if (!ensured.ok) {
      holdRepo(cx, s, "branch-conflict", ensured.note);
      continue;
    }
    const merged = await deps.mergeIn(path, base).catch((err: unknown): MergeInResult => ({ ok: false, conflict: false, files: [], note: message(err) }));
    if (!merged.ok) {
      holdRepo(cx, s, "branch-conflict", merged.note);
      continue;
    }
    if (merged.changed) s.lastMergeInSha = merged.sha;
    cx.paths.set(repo, { path, base });
    ready.push(repo);
  }
  return ready;
}

/** Start the run, WAITING while the org's one run slot is taken (a manual run). Null = not started:
 *  a stop arrived while waiting, or the refusal named repos, which are now paused. */
async function startWhenSlotFree(cx: Ctx, repos: string[]): Promise<{ id: string } | null> {
  let announced = false;
  for (;;) {
    if (cx.st.stopRequested) return null;
    try {
      return await cx.deps.startRun(runnerRunInput(cx.st, repos, cx.actor));
    } catch (err) {
      const why = message(err);
      if (RUN_SLOT_BUSY.test(why)) {
        if (!announced) {
          announced = true;
          event(cx, { event: "slot-wait", note: "Another loop run is active for this organization — the runner waits for it to finish." });
          await cx.deps.save(cx.st);
        }
        await cx.deps.sleep(RUNNER_SLOT_POLL_MS);
        await beat(cx);
        continue;
      }
      // A refusal about repos (pairings that broke since the step began) pauses EVERY repo it names;
      // `startLoopRun` lists them all in one refusal, and `reposNamedIn` is the parser that ships
      // beside that producer (pairing-health.ts). Any other refusal is not the runner's to interpret
      // and ends it in `error`, with the reason.
      const named = reposNamedIn(why, repos);
      if (named.length === 0) throw err;
      for (const repo of named) holdRepo(cx, stateOf(cx.st, repo), "repo-failures", `The run could not start: ${why}`);
      await cx.deps.save(cx.st);
      return null;
    }
  }
}

async function waitRunEnd(cx: Ctx, runId: string): Promise<void> {
  let stopSent = false;
  for (;;) {
    if (await cx.deps.runEnded(runId).catch(() => false)) return;
    if (cx.st.stopRequested && !stopSent) {
      stopSent = true;
      await cx.deps.stopRun(runId).catch(() => null);
    }
    await cx.deps.sleep(DRIVE_POLL_MS);
    await beat(cx);
  }
}

/**
 * Fold a finished run into each repo it worked, then read where each runner branch now stands. A run
 * the operator STOPPED, or the account's session limit cut short, earns no streak and no pause
 * (`streaks: false`) — but the branch facts are facts either way, and "Merge runner" needs them.
 */
async function settleRepos(cx: Ctx, repos: readonly string[], lanes: readonly RunnerLaneView[], streaks: boolean): Promise<void> {
  const outcomes = summarizeRunLanes(lanes);
  const now = cx.deps.now();
  for (const repo of repos) {
    const s = stateOf(cx.st, repo);
    const o = outcomes.get(repo);
    const paused = streaks ? applyRunOutcome(s, o, now) : null;
    if (paused) event(cx, { event: "repo-paused", repo, reason: paused, until: s.pausedUntil, note: s.note ?? "" });
    const at = cx.paths.get(repo);
    if (!at) continue;
    s.aheadOfBase = await cx.deps.aheadCount(at.path, at.base).catch(() => s.aheadOfBase);
    if (o && o.landed > 0) s.lastLandedSha = (await cx.deps.runnerTip(at.path).catch(() => null)) ?? s.lastLandedSha;
  }
}

function trimLedger(st: DriveStatus): void {
  const extra = st.runs.length - RUNNER_LEDGER_RUNS;
  if (extra <= 0) return;
  // The folded runs are still COUNTED: `runsBefore` carries them, so `driveRunsDone` stays true.
  const dropped = st.runs.splice(0, extra);
  st.runsBefore += dropped.filter((r) => r.endedAt != null).length;
}

async function runOnce(cx: Ctx, planned: readonly string[]): Promise<void> {
  const { st, deps } = cx;
  for (const repo of wakeRepos(st.repoState ?? [], deps.now())) {
    event(cx, { event: "repo-resumed", repo, note: "The back-off is over — the repo gets lanes again." });
  }
  st.phase = "running";
  const ready = await prepareRepos(cx, planned);
  await deps.save(st);
  if (ready.length === 0) return;
  const run = await startWhenSlotFree(cx, ready);
  if (!run) return;
  const rec: DriveRunRecord = {
    runId: run.id,
    repos: ready,
    debtBefore: st.measurement?.debt ?? 0,
    debtAfter: null,
    startedAt: iso(deps.now()),
    endedAt: null,
    verifiedCloses: null,
    landed: null,
  };
  st.runs.push(rec);
  await deps.save(st);
  await waitRunEnd(cx, run.id);
  const lanes = await deps.listLanes(run.id).catch(() => [] as RunnerLaneView[]);
  rec.endedAt = iso(deps.now());
  rec.verifiedCloses = lanes.reduce((n, l) => n + l.closedIds.length, 0);
  rec.landed = lanes.filter((l) => l.landedAt != null).length;
  st.measurement = (await deps.measure(st.org, st.repos).catch(() => null)) ?? st.measurement;
  rec.debtAfter = st.measurement?.debt ?? null;
  // A run the ACCOUNT cut short (session limit) says nothing about the repos: its failed lanes earn no
  // failure streak and its empty ones no dry back-off — the runner-wide pause is the whole answer.
  const hit = st.stopRequested ? null : sessionLimitBreaker(sessionLimitTexts(lanes), deps.now());
  await settleRepos(cx, ready, lanes, !st.stopRequested && !hit);
  if (hit) pauseRunner(cx, hit);
  trimLedger(st);
  await deps.save(st);
}

/**
 * Pull a continuous drive until it is stopped. Resolves when it ends `stopped`; a throw is the
 * caller's to record as `error` (`launchRunner`), exactly as the bounded driver's is.
 */
export async function runContinuous(st: DriveStatus, actor: string | null, deps: RunnerDeps): Promise<void> {
  const cx: Ctx = { st, actor, deps, savedAt: 0, paths: new Map() };
  st.repoState = reconcileRepoState(st.repos, st.repoState ?? []);
  st.measurement = (await deps.measure(st.org, st.repos).catch(() => null)) ?? st.measurement;
  await beat(cx, true);
  for (;;) {
    await beat(cx);
    if (st.stopRequested) break;
    const now = deps.now();
    liftElapsedPause(cx, now);
    if (!st.pausedReason) {
      const spent = await deps.spendSince(st.org, localMidnight(now)).catch(() => null);
      const hit = spendCeilingBreaker(spent, st.spendCeilingMicros ?? null, now);
      if (hit) {
        pauseRunner(cx, hit);
        await deps.save(st);
      }
    }
    const step = planRunnerStep({
      stopRequested: st.stopRequested,
      pausedReason: st.pausedReason ?? null,
      pausedUntil: st.pausedUntil ?? null,
      repos: st.repos,
      repoState: st.repoState ?? [],
      now,
    });
    if (step.action === "stop") break;
    if (step.action === "pause") await waitIn(cx, "paused", step.until);
    else if (step.action === "idle") await waitIn(cx, "idle", step.until);
    else await runOnce(cx, step.repos);
  }
  st.phase = "stopped";
  st.endedAt = iso(deps.now());
  st.lastBeatAt = st.endedAt;
  await deps.save(st);
}
