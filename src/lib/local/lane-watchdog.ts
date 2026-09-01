// LANE WATCHDOG — the hard ceiling on ONE lane cycle, and the teeth behind a stop.
//
// WHY THIS EXISTS. The loop had per-CALL timeouts — one agent session, one verification command, one
// git invocation — and NO ceiling on a cycle or a lane. Every one of those inner waits can fail to
// settle: a killed child whose stdio a grandchild still holds never fires `close`, a provider call
// can ignore its abort, a filesystem call on a locked worktree can block. When one does, the lane
// parks the org's single run slot indefinitely and the campaign's remaining budget is lost.
//
// The evidence is two dead campaigns. Run cbe04a35 lane `xkazm04/systedo-case` cycle 3: the guard's
// after-run verification hit its 10-minute cap ("The verification command exceeded 10 min and was
// stopped") and the lane's verdict was not written until EIGHT HOURS later, at the exact minute the
// campaign driver gave up — so nothing after the timeout ever settled on its own. Earlier, a lane
// wedged in `rescanning/score` for 75 minutes: `stopLoopRun` returned ok, the phase stayed `running`,
// and only a dev-server restart cleared it.
//
// THE RULE. Every awaited stage of a lane runs inside a RACE against ONE absolute deadline. A stuck
// call is not cancelled — nothing can promise that from the outside — it is ORPHANED: the lane
// advances without it, force-failed, with the stage that was in flight recorded on its row. Killing a
// child is not enough and is not what this relies on; the WAIT resolving is the whole mechanism.
//
// This module is deliberately dependency-free apart from the timeout band it shares with the run's
// dials (`run-limits.ts`) and the one env read that resolves a deployment's own session ceiling. It
// spawns nothing and touches no database, so the rule is unit-testable with a promise that never
// settles.

import { envNumber } from "@/lib/llm/config";
import {
  AGENT_TIMEOUT_CAP_MS,
  AGENT_TIMEOUT_DEFAULT_MS,
  AGENT_TIMEOUT_MIN_MS,
  normalizeAgentTimeoutMs,
} from "@/lib/local/run-limits";

/**
 * Per-session ceiling for one agent run. A fix batch is a real working session — default 20 min,
 * env-tunable, and RAISEABLE PER RUN inside a hard ceiling.
 *
 * (Lifted here from `agent.ts`, which re-exports it unchanged, because the LANE deadline below is
 * derived from it: the ceiling on a cycle and the ceiling on the session inside it are one question,
 * and a lane that resolved the session ceiling differently from the runner would be a lane whose
 * deadline fires while its own agent is still legitimately working.)
 *
 * The per-run override exists because 20 minutes is the wrong number for the work the loop is being
 * asked to do. A campaign lane committed the literal line `Agent session exceeded 20 min and was
 * stopped`: a structural change in progress, killed by the clock, and discarded with the worktree.
 *
 * It is bounded on BOTH sides and the ceiling is not negotiable from the wire: the timeout is what
 * ends a wedged headless session, which otherwise holds a lane, a worktree and a batch of claimed
 * rows. The same "0 is a misconfiguration, not 'no timeout'" floor as every other timeout knob, and
 * an override outside the band is IGNORED rather than clamped — `normalizeAgentTimeoutMs` has already
 * refused it at the route, so anything arriving here out of band is a stale caller and the honest
 * answer is the deployment's own value.
 */
export function agentTimeoutMs(override?: number | null): number {
  const chosen = normalizeAgentTimeoutMs(override ?? null);
  if (chosen != null) return chosen;
  return Math.min(
    AGENT_TIMEOUT_CAP_MS,
    Math.max(AGENT_TIMEOUT_MIN_MS, envNumber("ASCENT_AUTOPILOT_TIMEOUT_MS", AGENT_TIMEOUT_DEFAULT_MS)),
  );
}

/**
 * ALLOWANCE for the lane's rescan — twenty minutes.
 *
 * Not a timeout: nothing enforces it on its own. It is the rescan's share of the cycle ceiling, and
 * twenty minutes is what the measurement says a rescan costs — a local `claude-cli` scan runs ~6 min
 * median with one observed at >11 min (see the scan-timing note), so the allowance is roughly double
 * the worst honest reading rather than a round number.
 */
export const LANE_RESCAN_ALLOWANCE_MS = 1_200_000;

/**
 * ALLOWANCE for everything the lane asks of git and the filesystem — five minutes, in total, across
 * the whole cycle: `rev-parse`, the lane's commit, `rev-list`, `status`, the guard's discard. Each of
 * those is a sub-second operation on a local worktree; five minutes is the slack for a cold cache on
 * a large repository, not a budget anything is expected to spend.
 */
export const LANE_GIT_ALLOWANCE_MS = 300_000;

/**
 * THE LANE'S DEADLINE, DERIVED FROM THE RUN'S OWN PARAMETERS — never a fresh knob.
 *
 *     deadline = the agent session ceiling            (the run's `agentTimeoutMs`, else the env default)
 *              + 2 × the verification budget          (the guard runs the command TWICE: baseline, then result)
 *              + LANE_RESCAN_ALLOWANCE_MS
 *              + LANE_GIT_ALLOWANCE_MS
 *
 * The derivation is the point. An operator who raises `agentTimeoutMs` from 20 to 60 minutes raises
 * the lane ceiling by exactly those 40 minutes; one who raises `verifyTimeoutMs` by 5 raises it by 10,
 * because the guard runs twice; one who turns the guard off drops both runs from it. Nobody has to
 * discover a second dial to keep a legitimately long cycle alive, and nobody can raise one dial into a
 * lane that outlives its own ceiling.
 *
 * Default run: 20 + 2×10 + 20 + 5 = 65 minutes. That is a CEILING, not a target — a normal cycle is
 * nowhere near it, and a lane that reaches it is by construction stuck rather than slow.
 */
export function laneDeadlineMs(p: {
  /** The agent ceiling ALREADY RESOLVED (`agentTimeoutMs(run.agentTimeoutMs)`). */
  agentMs: number;
  /** One verification run's budget, already resolved (`verifyTimeoutMsOf(run.verifyTimeoutMs)`). */
  verifyMs: number;
  /** False when the run's guard is off — then neither verification run happens, and neither is paid for. */
  verifyEnabled?: boolean;
}): number {
  const guardMs = p.verifyEnabled === false ? 0 : 2 * p.verifyMs;
  return Math.max(1, Math.round(p.agentMs + guardMs + LANE_RESCAN_ALLOWANCE_MS + LANE_GIT_ALLOWANCE_MS));
}

/**
 * HOW LONG A COOPERATIVE STOP IS GIVEN BEFORE THE WATCHDOG BITES — two minutes.
 *
 * A stop is still honoured cooperatively first: the engine sets its flag, and a lane that reaches one
 * of its between-phase checkpoints winds down cleanly with its work committed, exactly as it always
 * did. Two minutes is the grace for a lane that is between stages or inside a short one. A lane still
 * in flight after it is not being polite — it is inside a stage that is not coming back, which is the
 * case that used to need a server restart.
 */
export const LANE_STOP_GRACE_MS = 120_000;

/**
 * How long after the abort the engine waits before declaring the RUN terminal anyway — thirty
 * seconds. The abort resolves each lane's race immediately, so this window is for the lane's own
 * wind-down writes (release the claim, end the row), not for the wedged call. If the run is still
 * live when it expires, some inner call refused to die and the run row says so by name.
 */
export const LANE_STOP_TERMINAL_MS = 30_000;

/** The stages of a lane cycle a watchdog can be waiting on. Recorded on the row when one is cut. */
export const LANE_STAGES = ["baseline", "agent", "install", "verify", "commit", "rescan", "refresh", "git"] as const;
export type LaneStage = (typeof LANE_STAGES)[number];

/** What each stage IS, in a sentence a lane log or an outcome sheet can print verbatim. */
export const LANE_STAGE_LABEL: Record<LaneStage, string> = {
  baseline: "measuring the degradation guard's baseline",
  agent: "the agent session",
  install: "writing the generated files",
  verify: "verifying the session's result",
  commit: "committing the session's work",
  rescan: "rescanning the worktree",
  // The DRY-LANE refresh: a lane that found no work at all rescans the PAIRED CHECKOUT instead, so a
  // repository whose roadmap ran dry gets a fresh reading rather than looping forever on an empty
  // one. It is a scan like any other, so it is paid for out of the same `LANE_RESCAN_ALLOWANCE_MS`
  // the cycle ceiling already carries — a dry lane does nothing else, so it cannot exceed it.
  refresh: "refreshing this repository's reading from the paired checkout",
  git: "a git command in the worktree",
};

/** Why a lane was cut short: its own ceiling, or an operator's stop. */
export type LaneAbortReason = "deadline" | "stopped";

/** Thrown INTO the lane from the race — carries which stage was in flight, which is the fact the
 *  outcome sheet needs and the one a silent gap used to destroy. */
export class LaneDeadlineError extends Error {
  readonly stage: LaneStage | null;
  readonly reason: LaneAbortReason;
  constructor(stage: LaneStage | null, reason: LaneAbortReason, message: string) {
    super(message);
    this.name = "LaneDeadlineError";
    this.stage = stage;
    this.reason = reason;
  }
}

/** `instanceof` behind a predicate, so the lane's `catch` blocks can re-throw it without importing
 *  the class into every one of them. */
export const isLaneDeadlineError = (err: unknown): err is LaneDeadlineError => err instanceof LaneDeadlineError;

export interface LaneWatchdog {
  /** The ceiling this lane runs under, in ms — what the force-fail message quotes. */
  readonly deadlineMs: number;
  /** Run one stage under the deadline. Resolves with the stage's value, or REJECTS with a
   *  `LaneDeadlineError` the moment the deadline (or a stop) fires — even if `work()` never settles. */
  stage<T>(name: LaneStage, work: () => Promise<T>): Promise<T>;
  /** Cut the lane NOW, as a stop rather than a timeout. Idempotent. */
  abort(): void;
  /** The stage that was in flight when the watchdog fired, or null (fired between stages / not fired). */
  readonly firedStage: LaneStage | null;
  readonly firedReason: LaneAbortReason | null;
  /** True once the watchdog has fired — the engine reads it to name the lanes that refused to die. */
  readonly fired: boolean;
  /** Drop the timer. Called on EVERY exit path of the lane, so a finished cycle leaves nothing armed. */
  dispose(): void;
}

/**
 * One watchdog per lane cycle.
 *
 * ONE TIMER, armed LAZILY at the first stage and cleared by `dispose()`. Not one per stage: a normal
 * fast cycle must be observably what it was before this existed, and a per-stage timer would be a
 * schedule/clear pair on every await. The timer is `unref`'d where the runtime supports it, so it can
 * never be the thing holding a process open.
 *
 * The rejection channel is a SINGLE promise created once and given a no-op `catch` immediately: a
 * watchdog that fires while the lane happens to be between stages (nobody racing) must not surface as
 * an unhandled rejection, and the next `stage()` call still throws it.
 */
export function createLaneWatchdog(opts: { deadlineMs: number }): LaneWatchdog {
  const deadlineMs = Math.max(1, Math.round(opts.deadlineMs));
  let current: LaneStage | null = null;
  let fired: LaneDeadlineError | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;
  let trip: (err: LaneDeadlineError) => void = () => {};
  const tripped = new Promise<never>((_resolve, reject) => {
    trip = reject;
  });
  // See the header: the channel is always "handled", so an unraced trip is silent rather than fatal.
  void tripped.catch(() => {});

  const fire = (reason: LaneAbortReason): void => {
    if (fired || disposed) return;
    const stage = current;
    const where = stage ? ` while ${LANE_STAGE_LABEL[stage]} was in flight` : " between stages";
    fired = new LaneDeadlineError(
      stage,
      reason,
      reason === "deadline"
        ? `the cycle exceeded its ${Math.round(deadlineMs / 60_000)} min deadline${where}`
        : `the run was stopped${where}`,
    );
    if (timer) clearTimeout(timer);
    timer = null;
    trip(fired);
  };

  const arm = (): void => {
    if (timer || disposed || fired) return;
    timer = setTimeout(() => fire("deadline"), deadlineMs);
    (timer as unknown as { unref?: () => void }).unref?.();
  };

  return {
    deadlineMs,
    get firedStage() {
      return fired?.stage ?? null;
    },
    get firedReason() {
      return fired?.reason ?? null;
    },
    get fired() {
      return fired != null;
    },
    async stage<T>(name: LaneStage, work: () => Promise<T>): Promise<T> {
      // A lane that already lost its race does not start another stage. This is what stops a cut lane
      // from carrying on through the rest of the cycle when an inner `catch` swallows the rejection.
      if (fired) throw fired;
      current = name;
      arm();
      try {
        return await Promise.race([work(), tripped]);
      } finally {
        if (!fired) current = null;
      }
    },
    abort() {
      fire("stopped");
    },
    dispose() {
      disposed = true;
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}
