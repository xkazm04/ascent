// Minimal git-CLI seam for LOCAL MODE (self-hosted deployments only) — the pairing verifier, the
// local ingestion source, and the autopilot all shell out through this one wrapper.
//
// Design rules, in order of importance:
//   1. execFile, NEVER a shell. Paths and ref names are operator-supplied strings; a shell would turn
//      "repo; rm -rf" into an incident. execFile passes argv verbatim, so the worst a hostile string
//      can be is a git error.
//   2. Bounded everything: a timeout per call and a maxBuffer cap, so a pathological repo (or a git
//      that hangs on a network credential prompt) degrades to a clean error, not a stuck request.
//      GIT_TERMINAL_PROMPT=0 makes any credential prompt fail immediately instead of blocking.
//   3. Read-only by default: everything here inspects state. The autopilot's WRITING git calls
//      (worktree add, checkout -b) also route through runGit so they inherit the same discipline.

import { execFile } from "node:child_process";

/** Hard ceiling on any single git invocation. Local git is fast; a call that takes longer than this
 *  is wedged (credential prompt, dead network FS), not slow. */
const GIT_TIMEOUT_MS = 15_000;
/** stdout cap — `git ls-files` on a huge monorepo is the biggest legitimate output (~a few MB). */
const GIT_MAX_BUFFER = 32 * 1024 * 1024;

export interface GitResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

/** Run `git <args>` in `cwd`. Never throws — a missing binary, a non-repo cwd, or a timeout all
 *  come back as `ok:false` with the stderr, because every caller treats them the same way: as a
 *  verification failure to surface, not an exception to unwind. */
export function runGit(cwd: string, args: readonly string[], opts: { timeoutMs?: number } = {}): Promise<GitResult> {
  return new Promise((resolve) => {
    execFile(
      "git",
      args as string[],
      {
        cwd,
        timeout: opts.timeoutMs ?? GIT_TIMEOUT_MS,
        maxBuffer: GIT_MAX_BUFFER,
        windowsHide: true,
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0" },
      },
      (error, stdout, stderr) => {
        resolve({ ok: !error, stdout: stdout ?? "", stderr: (stderr ?? "").slice(0, 4_000) });
      },
    );
  });
}

/** `owner/name` extracted from a git remote URL (https, ssh, with/without .git), lowercased for
 *  comparison — or null when the URL has no recognizable owner/repo tail. Host-agnostic on purpose:
 *  a GitHub Enterprise or mirrored origin still verifies against the paired fullName. */
export function ownerRepoFromRemoteUrl(url: string): string | null {
  const m = url
    .trim()
    .replace(/\.git$/i, "")
    .match(/[/:]([^/:]+)\/([^/:]+)$/);
  return m ? `${m[1]}/${m[2]}`.toLowerCase() : null;
}
