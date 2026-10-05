// ONE GATE-REPAIR TURN — when the gate a lane DECLARED does not pass on the lane's own tree.
//
// Measured 2026-10-05, the standing runner on an Unreal repository with no runnable check: the agent
// bootstrapped the repo's first gate (`node tools/lint.mjs && node apps/vr/tools/check-pin.mjs`,
// declared in `.ai/manifest.yaml`), but a lane session has no shell, so it could never run its own
// scripts. The integrity guard correctly refused the gate ("the newly declared gate does not pass
// here") and voided the lane — and the next lane started from the runner tip WITHOUT that work and
// wrote another untested gate blind. A no-gate repository could then never acquire one. The missing
// piece was feedback: the session never saw WHY its gate failed.
//
// So, exactly once per lane, the SAME session is resumed with the failing command(s) and the first
// failure lines of each run, asked to fix the scripts without weakening them, its residue committed
// through the lane's own commit path, and the guard re-judged on fresh evidence. This copies the
// shape of the planning repair turn (lane-plan.ts `PLAN_REPAIR_PROMPT`): one bounded resume, one
// re-check, and a second miss stays exactly the verdict it would have been.
//
// THE SCOPE IS ONE REFUSAL, decided structurally rather than by reading the reason's prose: the new
// gate was eligible to run (`declaredGateCommands` — not vacuous, the lane's verdict was the right
// one), it DID run, nothing passed, and — the counterfactual — had it passed, the guard would have
// cleared the lane. Any other surface hit (a weakened test, a vacuous gate, a verdict reached with a
// different command) gets no repair turn: repairing a gate is not a licence to argue with the guard.
//
// Pure orchestration over injected deps, so every branch is unit-testable; loop-lane.ts binds them.

import type { AgentRunResult } from "@/lib/local/agent";
import type { GateDiffOptions, VoidVerdict } from "@/lib/local/lane-gate-diff";
import { declaredGateCommands, type DeclaredGateRun, type LaneVerdictEvidence } from "@/lib/local/lane-gate-diff-declare";
import { firstFailureLines } from "@/lib/local/lane-verify";

/** The repair turn fixes scripts the session already wrote: minutes, never the full agent budget. */
export const GATE_REPAIR_TIMEOUT_MS = 10 * 60_000;
/** The whole failure excerpt the prompt carries, across every failing run. */
const FAILURE_BUDGET_CHARS = 1_500;
/** The second failure's excerpt in a void reason — a ledger column, so tighter. */
const REASON_FAILURE_CHARS = 600;

/** Sent on the RESUMED execution session, ahead of the failing commands and their output. */
export const GATE_REPAIR_PROMPT = [
  "Your declared gate does not pass on your own result. The Ascent lane ran it on the tree you left, and it failed as shown below.",
  "Fix the scripts or config so this gate passes. Do NOT weaken it: do not delete checks, do not make it vacuous (no `echo`, `true`, `exit 0` or skipped steps), and do not change which command is declared unless that command itself is wrong.",
  "Do not touch anything unrelated to making this gate pass. You still have no shell: leave your edits in the working tree and the lane commits them.",
].join("\n");

/** The repair turn's bound: the lane's own agent dial, capped. Absent dial = the cap. */
export function gateRepairTimeoutMs(agentTimeoutMs: number | null | undefined): number {
  return agentTimeoutMs && agentTimeoutMs > 0 ? Math.min(agentTimeoutMs, GATE_REPAIR_TIMEOUT_MS) : GATE_REPAIR_TIMEOUT_MS;
}

/** Below this, a repair turn could not do real work before the lane's deadline. */
const MIN_REPAIR_MS = 2 * 60_000;
/** Kept back for the commit and git reads after the turn. */
const REPAIR_GIT_SLACK_MS = 60_000;

/**
 * THE TURN MUST FIT INSIDE THE LANE'S OWN DEADLINE. The watchdog's ceiling was sized before anyone
 * knew a repair would happen (lane-watchdog.ts), and a turn it cuts force-fails the lane — a worse
 * outcome than the void it set out to fix. So the turn gets what is left after the gate's re-run (and
 * the guard's re-verify, when there is one) and some git slack, capped by `gateRepairTimeoutMs`; null
 * when that is under two minutes, and then no turn is spent.
 */
export function gateRepairBudgetMs(p: { remainingMs: number; agentTimeoutMs: number | null | undefined; verifyMs: number; reverify: boolean }): number | null {
  const left = p.remainingMs - p.verifyMs * (p.reverify ? 2 : 1) - REPAIR_GIT_SLACK_MS;
  const ms = Math.min(gateRepairTimeoutMs(p.agentTimeoutMs), left);
  return ms >= MIN_REPAIR_MS ? Math.floor(ms) : null;
}

/**
 * The failing runs, when the guard's refusal is exactly "the newly declared gate does not pass here"
 * and nothing else stands between the lane and clearing (header). Null otherwise — including a gate
 * that was never run, which a repair turn could not inform.
 */
export function failingDeclaredGate(
  changedPaths: readonly string[],
  evidence: GateDiffOptions,
  gateDiff: (paths: string[], evidence: GateDiffOptions) => VoidVerdict,
): DeclaredGateRun[] | null {
  const ladder = evidence.verifyLadder;
  if (!ladder) return null;
  // Empty when the change voids whatever the gate does: vacuous, wrong verdict, removed gate.
  const wanted = declaredGateCommands(ladder, evidence.laneVerdict);
  if (wanted.length === 0) return null;
  const tried = (evidence.declaredGateRuns ?? []).filter((r) => wanted.some((w) => w.command === r.command));
  if (tried.length === 0 || tried.some((r) => r.ok)) return null;
  // THE COUNTERFACTUAL: the same evidence with every eligible rung passing. If the guard would STILL
  // void, the failing gate is not the reason (or not the only one), and no repair turn is spent.
  const passing: DeclaredGateRun[] = wanted.map((w) => ({ command: w.command, rung: w.rung, ok: true, timedOut: false }));
  if (gateDiff([...changedPaths], { ...evidence, declaredGateRuns: passing }).void) return null;
  return tried;
}

/** Each failing run's command and first failure lines, bounded to `budget` characters in all. */
export function failureExcerpt(runs: readonly DeclaredGateRun[], budget = FAILURE_BUDGET_CHARS): string {
  const per = Math.max(120, Math.floor(budget / Math.max(1, runs.length)));
  return runs
    .map((r) => {
      const how = r.timedOut ? "timed out" : "failed";
      const lines = r.output != null ? firstFailureLines(r.output, 12, per) : "(its output was not captured)";
      return `\`${r.command}\` (${r.rung}) ${how}:\n${lines}`;
    })
    .join("\n\n")
    .slice(0, budget);
}

/** The whole prompt for the repair turn. */
export function gateRepairPrompt(runs: readonly DeclaredGateRun[]): string {
  return `${GATE_REPAIR_PROMPT}\n\nTHE FAILING GATE:\n${failureExcerpt(runs)}`;
}

/** What the degradation guard says about the repaired tree (lane-guard.ts `GuardOutcome`, narrowed). */
export interface RepairReverify {
  verdict: string;
  command: string | null;
  reject: boolean;
  note: string;
}

export interface GateRepairDeps<R extends RepairReverify = RepairReverify> {
  /** Resume `sessionId` with `prompt` — the caller binds transport, model, endpoint and the edit
   *  permission of the execution session, and the bounded timeout. */
  resume: (sessionId: string, prompt: string) => Promise<AgentRunResult>;
  /** Re-run the degradation guard against the cached baseline BEFORE the commit (a repo WITH a gate:
   *  the repair edited code). Absent for a no-check repo, whose verdict stays `skipped` until the
   *  bootstrap clears. */
  reverify?: (() => Promise<R>) | null;
  /** Commit the residue through the lane's own commit path. */
  commit: (summary: string, sessionFailed: boolean) => Promise<{ committed: boolean; summary: string }>;
  /** Re-read the gate-diff evidence for the lane's whole range, with this lane verdict. */
  readEvidence: (laneVerdict: LaneVerdictEvidence | null) => Promise<{ changedPaths: string[]; evidence: GateDiffOptions }>;
  gateDiff: (paths: string[], evidence: GateDiffOptions) => VoidVerdict;
  log: (line: string) => Promise<void>;
  /** An error that must END the lane rather than fail the turn — the watchdog's deadline. Rethrown. */
  isFatal?: (err: unknown) => boolean;
}

export interface GateRepairInput {
  /** The execution session's id; null (an adopting lane, an envelope without one, no time left) = no repair. */
  sessionId: string | null;
  changedPaths: readonly string[];
  evidence: GateDiffOptions;
  /** The guard's first verdict. */
  verdict: VoidVerdict;
  laneVerdict: LaneVerdictEvidence | null;
}

export type GateRepairOutcome<R extends RepairReverify = RepairReverify> =
  | { attempted: false }
  | {
      attempted: true;
      /** The verdict the lane proceeds on: the re-judgement, or a void naming the spent turn. */
      verdict: VoidVerdict;
      /** The lane verdict after a re-verify (unchanged when none ran). */
      laneVerdict: LaneVerdictEvidence | null;
      /** The degradation guard's word on the repaired tree, when it ran and passed — the call site persists it. */
      reverified: R | null;
      /** The repair session's own result (cost accounting), null when it threw. */
      session: AgentRunResult | null;
    };

const firstLineOf = (s: string | null | undefined): string => (s ?? "").split("\n").find((l) => l.trim())?.trim().slice(0, 200) ?? "";

/** A void that says the turn was spent, and how the second attempt ended. */
function spentVoid(base: VoidVerdict, how: string): VoidVerdict {
  const prior = (base.reason ?? "This lane's declared gate does not pass on its tree.").replace(/\s+$/, "");
  return { void: true, reason: `${prior} One gate-repair turn was spent on it: ${how}`, paths: base.paths };
}

/**
 * Spend at most ONE repair turn on a lane whose declared gate failed on its own tree (header). Returns
 * `{ attempted: false }` when the refusal is any other kind or there is no session to resume, and the
 * caller proceeds exactly as before. A dep that rejects is a failed turn — except a fatal one
 * (`isFatal`, the lane's deadline), which is rethrown so the lane does not walk on past its ceiling.
 */
export async function repairDeclaredGate<R extends RepairReverify>(input: GateRepairInput, deps: GateRepairDeps<R>): Promise<GateRepairOutcome<R>> {
  const { verdict, sessionId } = input;
  if (!verdict.void || !sessionId) return { attempted: false };
  const failing = failingDeclaredGate(input.changedPaths, input.evidence, deps.gateDiff);
  if (!failing) return { attempted: false };

  const soft = <T>(work: () => Promise<T>, fallback: T): Promise<T> =>
    work().catch((err: unknown) => {
      if (deps.isFatal?.(err)) throw err;
      return fallback;
    });
  await deps.log(
    `Gate repair: the gate this lane declared does not pass on its own tree (${failing.map((r) => `\`${r.command}\``).join(", ")}). ` +
      `Resuming its session ONCE with the failure output, to fix the scripts without weakening them.`,
  );
  let laneVerdict = input.laneVerdict;
  let reverified: R | null = null;
  let session: AgentRunResult | null = null;
  /** A void that names the spent turn and how the second attempt ended — logged, then returned. */
  const voided = async (base: VoidVerdict, how: string): Promise<GateRepairOutcome<R>> => {
    await deps.log(`Gate repair did not clear the lane: ${firstLineOf(how)}`);
    return { attempted: true, verdict: spentVoid(base, how), laneVerdict, reverified, session };
  };

  session = await soft(() => deps.resume(sessionId, gateRepairPrompt(failing)), null);
  if (!session || !session.ok) {
    // A failed turn may still have written: commit the residue so the worktree is clean and the work
    // is on the branch for the human, but do not re-judge a tree nothing finished.
    const residue = session?.summary ?? "The gate-repair turn did not answer.";
    await soft(() => deps.commit(residue, true), null);
    return voided(verdict, `the repair turn failed (${firstLineOf(session?.errorText || session?.summary) || "it did not answer"}).`);
  }

  // A repo WITH a gate: the repair edited code, so the degradation guard re-judges it against the
  // cached baseline before anything is committed — a regression is discarded exactly as it would be.
  if (deps.reverify) {
    const again = await soft(deps.reverify, null);
    if (!again || again.reject) {
      return voided(verdict, `the repaired tree ${again ? `regressed the repository's checks (${firstLineOf(again.note)})` : "could not be re-verified"}.`);
    }
    reverified = again;
    laneVerdict = { verdict: again.verdict, command: again.command };
  }

  const committed = await soft(() => deps.commit(session!.summary, false), { committed: false, summary: "the commit threw" });
  if (!committed.committed) return voided(verdict, `the repair turn left nothing committed (${firstLineOf(committed.summary)}).`);

  const fresh = await soft(() => deps.readEvidence(laneVerdict), null);
  if (!fresh) return voided(verdict, "the evidence could not be re-read after it.");
  const again = deps.gateDiff(fresh.changedPaths, fresh.evidence);
  if (!again.void) {
    await deps.log("Gate repair cleared the lane: the declared gate now passes on the repaired tree.");
    return { attempted: true, verdict: again, laneVerdict, reverified, session };
  }
  const second = (fresh.evidence.declaredGateRuns ?? []).filter((r) => !r.ok);
  return voided(again, second.length > 0 ? `the gate still does not pass — ${failureExcerpt(second, REASON_FAILURE_CHARS)}` : "the lane is still void.");
}
