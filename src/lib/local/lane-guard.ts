// THE A/B DEGRADATION GUARD, impure half: run the repository's own command, twice, and reverse the
// session's work when a pass became a failure.
//
//   A — the BASELINE. The pristine worktree, before the agent has touched anything. Measured on the
//       lane's FIRST cycle and cached for the rest of that worktree's life: a later cycle's HEAD
//       already carries the loop's own commits, so re-measuring would be asking "was the repo green
//       after we changed it", which is the question the result run answers.
//   B — the RESULT. The same command in the same worktree after the session exits and BEFORE the
//       lane commits. Before, because the whole point is that a rejected lane leaves no commit and no
//       branch to explain away.
//
// THE REVERSAL IS WORKTREE-ONLY, AND THAT BOUND IS THE WHOLE SAFETY ARGUMENT. `git reset --hard` and
// `git clean -fd` are the two most destructive commands in this codebase, and they run in exactly one
// place: a temporary checkout `createLoopWorktree` made minutes earlier, which `removeLoopWorktree`
// deletes at the end of the run regardless. The operator's own checkout is never the cwd of either
// call — `landLaneBranch` is the module that touches it, and it refuses to reset, stash or switch
// anything. `discardWorktreeEdits` takes the worktree dir it was handed and asserts nothing about it,
// so the ONE rule the caller must keep is: never pass it a paired path.
//
// RUNNING A REPOSITORY'S OWN COMMAND EXECUTES REPO-AUTHORED CODE. Plainly: `npm test` in a checkout
// runs whatever that repository's test script says, including its postinstall-shaped surprises. This
// loop already spawns an editing agent in that checkout, so the guard adds no capability that was not
// already there — but it is not therefore invisible, and it is gated the same way: self-hosted
// deployments only, `ASCENT_AUTOPILOT=1`, owner-only to arm, and a per-run `verifyMode: "off"` that
// turns it off entirely (`run-limits.ts`).

import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { runGit } from "@/lib/local/git";
import {
  VERIFY_GUIDANCE_PATHS,
  VERIFY_MANIFEST_PATH,
  VERIFY_PACKAGE_PATH,
  firstFailureLines,
  resolveVerifyCommand,
  type ResolvedVerify,
  type VerifyVerdict,
} from "@/lib/local/lane-verify";

/** One execution of the resolved command. Never throws: a spawn failure is `ok:false` with a reason,
 *  because the caller treats "it could not run" and "it ran and failed" as the same kind of fact —
 *  something to report on the lane, not an exception to unwind a cycle with. */
export interface VerifyRun {
  ok: boolean;
  /** stdout+stderr, already bounded. */
  output: string;
  /** True when the command hit the timeout rather than exiting. */
  timedOut: boolean;
}

const MAX_OUTPUT = 256 * 1024;

/**
 * Run one repo-authored command in `cwd` with a hard timeout.
 *
 * `shell: true` is REQUIRED and is not a lapse: what is being run is a command STRING the repository
 * wrote (`npm run check:ci && npm test`), not an argv the loop assembled. There is no injection
 * surface to protect here that is not already the point — the string is the repository's own, the
 * same repository whose files an editing agent is about to rewrite. What the flag does not get is a
 * new blast radius: the cwd is the throwaway worktree, and `ANTHROPIC_API_KEY` is stripped exactly as
 * it is for the agent session.
 *
 * A TIMEOUT IS A FAILURE, and deliberately so on both sides. On the baseline it means the repository's
 * own gate does not finish inside the budget, which is `baseline-red` — honest, and it stops the guard
 * silently costing every lane ten minutes for nothing. On the result run it means the session left
 * the repository in a state its own checks cannot get through, which is a degradation.
 */
export function runVerifyCommand(cwd: string, command: string, timeoutMs: number): Promise<VerifyRun> {
  return new Promise((resolve) => {
    const env = { ...process.env };
    delete env.ANTHROPIC_API_KEY;
    // CI=1 is what turns a watch-mode test runner into a one-shot one. Without it a repo whose `test`
    // script is `vitest` (not `vitest run`) would hold the lane until the timeout, every cycle.
    env.CI = "1";
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(command, { shell: true, cwd, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    } catch (err) {
      resolve({ ok: false, output: `Could not run the verification command: ${err instanceof Error ? err.message : String(err)}`, timedOut: false });
      return;
    }
    let out = "";
    let settled = false;
    const append = (d: Buffer) => {
      if (out.length < MAX_OUTPUT) out += d.toString("utf8").slice(0, MAX_OUTPUT - out.length);
    };
    const settle = (r: VerifyRun) => {
      if (settled) return;
      settled = true;
      resolve(r);
    };
    const timer = setTimeout(() => {
      child.kill();
      settle({ ok: false, output: `${out}\nThe verification command exceeded ${Math.round(timeoutMs / 60_000)} min and was stopped.`, timedOut: true });
    }, timeoutMs);
    child.stdout?.on("data", append);
    child.stderr?.on("data", append);
    child.on("error", (e) => {
      clearTimeout(timer);
      settle({ ok: false, output: `Could not run the verification command: ${e.message}`, timedOut: false });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      settle({ ok: code === 0, output: out, timedOut: false });
    });
  });
}

/** Read the declaration files the resolver consults. A file that is not there is simply absent — a
 *  repository is allowed to declare nothing, and that is the SKIPPED verdict, not an error. */
export async function readVerifyInputs(dir: string): Promise<{
  manifestYaml: string | null;
  guidance: { path: string; text: string }[];
  packageJson: string | null;
}> {
  const read = async (rel: string): Promise<string | null> =>
    readFile(path.join(dir, rel), "utf8").catch(() => null);
  const [manifestYaml, packageJson] = await Promise.all([read(VERIFY_MANIFEST_PATH), read(VERIFY_PACKAGE_PATH)]);
  const guidance: { path: string; text: string }[] = [];
  for (const rel of VERIFY_GUIDANCE_PATHS) {
    const text = await read(rel);
    if (text) guidance.push({ path: rel, text });
  }
  return { manifestYaml, guidance, packageJson };
}

/** Resolve the command this worktree's repository declares, reading it off disk. */
export async function resolveVerifyForWorktree(dir: string): Promise<ResolvedVerify | null> {
  return resolveVerifyCommand(await readVerifyInputs(dir));
}

/**
 * THROW AWAY EVERYTHING UNCOMMITTED IN A THROWAWAY WORKTREE. See the header: `dir` must be a loop
 * worktree, never a paired checkout.
 *
 * `reset --hard HEAD` reverses tracked edits; `clean -fd` removes the files the session created. Both
 * are needed — a session that "fixed" a module by adding a broken new one leaves nothing for the
 * reset to undo, and a worktree left carrying it would make the next cycle's baseline meaningless.
 * `.ascent/` is deliberately NOT preserved: the lane report has already been read and persisted by
 * the time this runs.
 */
export async function discardWorktreeEdits(dir: string): Promise<boolean> {
  const reset = await runGit(dir, ["reset", "--hard", "HEAD"]);
  const clean = await runGit(dir, ["clean", "-fd"]);
  return reset.ok && clean.ok;
}

/** The baseline measured once per worktree, then reused for that worktree's later cycles. */
export interface VerifyBaseline {
  resolved: ResolvedVerify | null;
  /** null when nothing was resolved — the guard is skipped and there is no pass/fail to record. */
  passed: boolean | null;
  /** The failure note when the baseline itself was red, for the lane log. */
  note: string | null;
}

/**
 * The per-worktree baseline cache.
 *
 * Keyed by the worktree DIRECTORY, which is unique per (run, repo, arm) and is deleted with the run.
 * This is the one piece of module state the loop tolerates, and it is safe to be: it is a pure
 * memoization of a measurement of an immutable moment (the worktree's HEAD at lane start), it is
 * keyed by a path no two lanes share, and losing it costs a re-measurement rather than a wrong
 * answer. `forgetVerifyBaseline` is called when the worktree is removed so a long-lived process does
 * not accumulate entries for directories that no longer exist.
 */
const BASELINES = new Map<string, VerifyBaseline>();

export const forgetVerifyBaseline = (dir: string): void => void BASELINES.delete(dir);
/** Test seam — the cache is process-global by design, so a suite has to be able to empty it. */
export const __clearVerifyBaselines = (): void => BASELINES.clear();

export interface GuardDeps {
  resolve: (dir: string) => Promise<ResolvedVerify | null>;
  run: (dir: string, command: string, timeoutMs: number) => Promise<VerifyRun>;
  discard: (dir: string) => Promise<boolean>;
}

export const defaultGuardDeps: GuardDeps = {
  resolve: resolveVerifyForWorktree,
  run: runVerifyCommand,
  discard: discardWorktreeEdits,
};

/**
 * A — measure (or recall) the pristine baseline for this worktree.
 *
 * Returns the cached entry unchanged on any cycle after the first. Never throws.
 */
export async function verifyBaseline(
  dir: string,
  timeoutMs: number,
  overrides: Partial<GuardDeps> = {},
): Promise<VerifyBaseline> {
  const cached = BASELINES.get(dir);
  if (cached) return cached;
  const deps = { ...defaultGuardDeps, ...overrides };
  const resolved = await deps.resolve(dir).catch(() => null);
  if (!resolved) {
    const entry: VerifyBaseline = { resolved: null, passed: null, note: null };
    BASELINES.set(dir, entry);
    return entry;
  }
  const run = await deps.run(dir, resolved.command, timeoutMs).catch(
    (err: unknown): VerifyRun => ({ ok: false, output: err instanceof Error ? err.message : String(err), timedOut: false }),
  );
  const entry: VerifyBaseline = {
    resolved,
    passed: run.ok,
    note: run.ok ? null : firstFailureLines(run.output),
  };
  BASELINES.set(dir, entry);
  return entry;
}

/** What the guard concluded, in the form the lane records and the ledger renders. */
export interface GuardOutcome {
  verdict: VerifyVerdict;
  /** The command that was run, or null when none was resolved. */
  command: string | null;
  /** One line for the lane log AND the persisted note — never empty, on every verdict. */
  note: string;
  /** True only for `rejected`: the lane must not commit, must not rescan, must not deliver. */
  reject: boolean;
}

/**
 * B — run the command again after the session and decide.
 *
 * The four verdicts, and the ONE that changes the lane's course:
 *   • baseline could not be resolved  → `skipped`, and the note says the repository declares no
 *     command. Not a pass.
 *   • baseline failed                 → `baseline-red`. The repository arrived broken; the agent is
 *     not blamed and the lane proceeds untouched.
 *   • baseline passed, result passed  → `verified`.
 *   • baseline passed, result failed  → `rejected`. The worktree's edits are discarded HERE, so the
 *     lane's own commit step finds a clean tree and there is nothing to commit even if a later caller
 *     forgets the flag. Belt and braces on the one path where a mistake would publish a regression.
 */
export async function verifyResult(
  dir: string,
  baseline: VerifyBaseline,
  timeoutMs: number,
  overrides: Partial<GuardDeps> = {},
): Promise<GuardOutcome> {
  if (!baseline.resolved || baseline.passed == null) {
    return {
      verdict: "skipped",
      command: null,
      note:
        "Verification SKIPPED: this repository declares no check the loop could resolve — no `.ai/manifest.yaml` control, " +
        "no command in its guidance files, and no conventional package.json script. This lane's work is UNVERIFIED, not verified.",
      reject: false,
    };
  }
  const { command, source } = baseline.resolved;
  if (!baseline.passed) {
    return {
      verdict: "baseline-red",
      command,
      note:
        `Verification BASELINE RED: \`${command}\` (from ${source}) already failed on this repository before the session started, ` +
        `so this cycle cannot be judged against it and the agent is not blamed for it. First failure: ${baseline.note ?? "(no output)"}`,
      reject: false,
    };
  }
  const deps = { ...defaultGuardDeps, ...overrides };
  const run = await deps.run(dir, command, timeoutMs).catch(
    (err: unknown): VerifyRun => ({ ok: false, output: err instanceof Error ? err.message : String(err), timedOut: false }),
  );
  if (run.ok) {
    return {
      verdict: "verified",
      command,
      note: `Verified: \`${command}\` (from ${source}) passed before this session and passes after it.`,
      reject: false,
    };
  }
  const discarded = await deps.discard(dir).catch(() => false);
  return {
    verdict: "rejected",
    command,
    note:
      `Verification REJECTED this cycle: \`${command}\` (from ${source}) passed before the session and ${run.timedOut ? "timed out" : "failed"} after it. ` +
      `${discarded ? "The edits were discarded in the throwaway worktree" : "The edits could NOT be discarded — check the worktree"}; nothing was committed and nothing will be delivered. ` +
      `First failure:\n${firstFailureLines(run.output)}`,
    reject: true,
  };
}

/** The lesson candidate a rejection leaves behind — a standing fact about this repository and this
 *  command, not an event, so it reads the same however many cycles hit it. */
export const verifyRejectionLesson = (repoFullName: string, outcome: GuardOutcome): string =>
  `A loop cycle on ${repoFullName} was reversed by the degradation guard: \`${outcome.command}\` passed before the agent's ` +
  `session and failed after it, so the work was discarded rather than committed. ${outcome.note.split("First failure:")[1]?.trim() ?? ""}`.trim();
