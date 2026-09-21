// DEPENDENCY LANES, process half — run one package-manager command in the lane worktree, bounded by a
// timeout and by the lane's abort signal, and end the whole process TREE when either fires.
//
// `shell` on win32 only: npm, pnpm and yarn are `.cmd` shims there, which a bare spawn cannot find. The
// command line is then ONE string built from constants this codebase wrote (`installCommand`), never
// from repository text, so there is no argument to escape — and passing an argv array together with
// `shell: true` is itself deprecated (DEP0190). Elsewhere it is a plain argv spawn.
//
// The environment is inherited — the package manager needs the operator's registry config, proxy and
// cache — minus `ANTHROPIC_API_KEY`, exactly as the guard's own command run strips it: nothing an
// install does needs the key, and a dependency is the last thing that should be handed it.

import { spawn } from "node:child_process";
import { detachForKillTree, killProcessTree } from "@/lib/local/kill-tree";
import type { InstallCommand } from "@/lib/local/lane-deps-detect";

export interface SpawnResult {
  /** The exit code; null when the process never exited on its own (killed, or never started). */
  code: number | null;
  /** stdout+stderr, the TAIL kept when it runs long — installers print their error last. */
  output: string;
  timedOut: boolean;
  aborted: boolean;
  /** Set when the process could not be started at all (a missing binary on POSIX). */
  spawnError: string | null;
}

export type SpawnInstall = (cmd: InstallCommand, opts: { cwd: string; timeoutMs: number; signal?: AbortSignal }) => Promise<SpawnResult>;

const MAX_OUTPUT = 128 * 1024;

export const spawnInstall: SpawnInstall = (cmd, { cwd, timeoutMs, signal }) =>
  new Promise((resolve) => {
    if (signal?.aborted) {
      resolve({ code: null, output: "", timedOut: false, aborted: true, spawnError: null });
      return;
    }
    const env: NodeJS.ProcessEnv = { ...process.env, ...cmd.env };
    delete env.ANTHROPIC_API_KEY;
    const onWindows = process.platform === "win32";
    let child: ReturnType<typeof spawn>;
    try {
      const options = { cwd, env, windowsHide: true, detached: detachForKillTree(), stdio: ["ignore", "pipe", "pipe"] as const };
      child = onWindows
        ? spawn([cmd.command, ...cmd.args].join(" "), { ...options, stdio: [...options.stdio], shell: true })
        : spawn(cmd.command, cmd.args, { ...options, stdio: [...options.stdio], shell: false });
    } catch (err) {
      resolve({ code: null, output: "", timedOut: false, aborted: false, spawnError: err instanceof Error ? err.message : String(err) });
      return;
    }
    let out = "";
    let settled = false;
    const append = (d: Buffer) => {
      out += d.toString("utf8");
      if (out.length > MAX_OUTPUT) out = out.slice(out.length - MAX_OUTPUT);
    };
    const settle = (r: SpawnResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolve(r);
    };
    // END THE TREE, THEN SETTLE. The kill is bounded (kill-tree.ts), and awaiting it is what lets the
    // caller's cleanup run against a worktree no half-killed installer is still writing into. While a
    // stop is in flight the child's own `close` is ignored, so a killed install can never be reported
    // as an ordinary non-zero exit — the timeout or the abort is the fact.
    let stopping: "timeout" | "abort" | null = null;
    const stop = async (why: "timeout" | "abort") => {
      if (settled || stopping) return;
      stopping = why;
      await killProcessTree(child.pid, { label: "dependency install" }).catch(() => null);
      settle({ code: null, output: out, timedOut: why === "timeout", aborted: why === "abort", spawnError: null });
    };
    const onAbort = () => void stop("abort");
    const timer = setTimeout(() => void stop("timeout"), timeoutMs);
    signal?.addEventListener("abort", onAbort, { once: true });
    child.stdout?.on("data", append);
    child.stderr?.on("data", append);
    child.on("error", (e) => {
      if (!stopping) settle({ code: null, output: out, timedOut: false, aborted: false, spawnError: e.message });
    });
    child.on("close", (code) => {
      if (!stopping) settle({ code, output: out, timedOut: false, aborted: false, spawnError: null });
    });
  });
