// KILL THE TREE, NOT THE SHELL — the one place that ends a spawned process AND its descendants.
//
// WHY THIS EXISTS. Every long-lived child in local mode is spawned with `shell: true` (required on
// Windows, where the Claude CLI is `claude.cmd` and a bare `spawn` cannot find it). `child.kill()`
// therefore signals the SHELL. On win32 the real process is a grandchild of `cmd.exe` and survives
// its parent without noticing; on POSIX the shell may `exec` into the binary — or may not, depending
// on the command — so the same call is a coin flip. A stopped loop run used to free the org's run
// slot in about two and a half minutes while the `claude -p` session it dispatched kept running,
// unmonitored, burning tokens against a run nobody was watching any more.
//
// THE INVARIANT THIS DOES NOT TOUCH. Killing is NOT the mechanism by which a lane is freed — settling
// is (see agent.ts and lane-watchdog.ts). Nothing here is ever awaited on the path that frees a lane.
// This is the ADDITIONAL half: the wait resolves regardless, and the process tree is ended as well
// instead of being left behind.
//
// HONESTY. The outcome is a `confirmed` boolean and a note written for a human log. "Unconfirmed" is
// a real and expected answer — a `taskkill` that cannot see the pid, a process group we lack
// permission to signal — and it is reported as such rather than rounded up to success. A log line
// that says "terminated" when nothing was terminated is worse than one that admits it does not know.

import { execFile } from "node:child_process";

/** How long the POSIX branch waits after SIGTERM before escalating to SIGKILL, and after SIGKILL
 *  before it gives up on confirming. Short on purpose: this runs after the lane has already been
 *  freed, so the only thing the delay costs is how long the note takes to be written. */
export const KILL_TREE_GRACE_MS = 3_000;

/** What the kill actually achieved, in a sentence a lane log or an outcome sheet can print verbatim. */
export interface KillTreeOutcome {
  /** True only when the tree was observed to be gone — never when we merely asked. */
  confirmed: boolean;
  /** `"agent process terminated (pid 123)"` / `"agent process termination unconfirmed (pid 123)"`. */
  note: string;
  pid: number | null;
}

/** Everything platform- or process-shaped, injectable so the two branches are unit-testable on one
 *  host. Production passes nothing and gets `process.platform`, `execFile` and `process.kill`. */
export type ExecFileLike = (
  file: string,
  args: readonly string[],
  options: { windowsHide?: boolean; timeout?: number },
  callback: (
    error: (Error & { code?: string | number | null }) | null,
    stdout: string | Buffer,
    stderr: string | Buffer,
  ) => void,
) => unknown;

export interface KillTreeDeps {
  platform?: NodeJS.Platform;
  execFileImpl?: ExecFileLike;
  /** `process.kill`, narrowed to what this module uses (signal `0` is the liveness probe). */
  kill?: (pid: number, signal: NodeJS.Signals | 0) => void;
  graceMs?: number;
  /** What the note calls the thing being killed. Defaults to the agent, its only caller today. */
  label?: string;
}

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    (t as unknown as { unref?: () => void }).unref?.();
  });

const note = (label: string, pid: number | null, confirmed: boolean): string =>
  confirmed
    ? `${label} terminated (pid ${pid ?? "unknown"})`
    : `${label} termination unconfirmed (pid ${pid ?? "unknown"})`;

/**
 * WINDOWS. `taskkill /PID <pid> /T /F` is the only thing that reaches a grandchild: `/T` is the tree
 * and `/F` is the force. It is invoked through `execFile` with an ARGUMENT ARRAY and never through a
 * shell, so the pid — a number we formatted ourselves — cannot become a command line.
 *
 * Exit code 128 means "the process is not there", which is the outcome we wanted; it is confirmed,
 * not failed. Any other non-zero exit is honestly unconfirmed.
 */
function killWin32(pid: number, deps: Required<Pick<KillTreeDeps, "execFileImpl" | "graceMs">>): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (ok: boolean) => {
      if (!settled) {
        settled = true;
        resolve(ok);
      }
    };
    try {
      deps.execFileImpl(
        "taskkill",
        ["/PID", String(pid), "/T", "/F"],
        { windowsHide: true, timeout: deps.graceMs },
        (error, _stdout, stderr) => {
          if (!error) return done(true);
          const text = typeof stderr === "string" ? stderr : stderr.toString("utf8");
          done(error.code === 128 || /not found|no running instance/i.test(text));
        },
      );
    } catch {
      done(false);
    }
  });
}

/**
 * POSIX. The child is spawned `detached: true` (see agent.ts), which makes it the leader of its own
 * process group, and a NEGATIVE pid signals that whole group — the shell and everything it started.
 * SIGTERM first so a well-behaved process can flush, SIGKILL after the grace, with a liveness probe
 * (signal `0`) on either side of it so the answer is observed rather than assumed.
 *
 * An `ESRCH` from any of these means the group is already gone: confirmed. An `EPERM` is reported the
 * same way as a live group — unconfirmed — because we genuinely cannot tell.
 */
async function killPosix(pid: number, deps: Required<Pick<KillTreeDeps, "kill" | "graceMs">>): Promise<boolean> {
  const group = -pid;
  const gone = (): boolean => {
    try {
      deps.kill(group, 0);
      return false;
    } catch (err) {
      return (err as { code?: string } | null)?.code === "ESRCH";
    }
  };
  try {
    deps.kill(group, "SIGTERM");
  } catch {
    return gone();
  }
  await delay(deps.graceMs);
  if (gone()) return true;
  try {
    deps.kill(group, "SIGKILL");
  } catch {
    return gone();
  }
  await delay(Math.min(deps.graceMs, 500));
  return gone();
}

/**
 * End the process TREE rooted at `pid`. Resolves — never rejects — with what it could confirm.
 *
 * A missing pid is not a failure: the child never started, or has already exited, and there is
 * nothing left to kill. That is reported as confirmed with a note that says which case it was.
 */
export async function killProcessTree(pid: number | null | undefined, deps: KillTreeDeps = {}): Promise<KillTreeOutcome> {
  const label = deps.label ?? "agent process";
  if (pid == null || !Number.isInteger(pid) || pid <= 0) {
    return { confirmed: true, note: `${label} had no live pid to terminate`, pid: null };
  }
  const platform = deps.platform ?? process.platform;
  const graceMs = Math.max(1, Math.round(deps.graceMs ?? KILL_TREE_GRACE_MS));
  const confirmed =
    platform === "win32"
      ? await killWin32(pid, { execFileImpl: deps.execFileImpl ?? (execFile as unknown as ExecFileLike), graceMs })
      : await killPosix(pid, { kill: deps.kill ?? ((p, s) => process.kill(p, s)), graceMs });
  return { confirmed, note: note(label, pid, confirmed), pid };
}

/** True on the platforms where a spawned child must be its OWN process-group leader for the kill
 *  above to reach its descendants. win32 has no process groups of this shape — `taskkill /T` walks
 *  the parent/child table instead — and `detached` there would open a console window. */
export const detachForKillTree = (platform: NodeJS.Platform = process.platform): boolean => platform !== "win32";
