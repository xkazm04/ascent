// DEPENDENCY LANES — the ENGINE installs, lifecycle scripts off, so an auto-approved dependency change
// can actually be verified (spark theater-upgrade, 2026-09-18; WP5 implements).
//
// A lane's worktree shares the paired checkout's dependency folder through a link (worktree-deps.ts),
// and the agent has no shell. So when a runner lane's session changed a manifest or lockfile, the
// engine (never the agent) replaces the link with the worktree's OWN dependency folder and runs the
// package manager's install with scripts disabled, so the guard's after-check runs against the new
// dependencies and the updated lockfile is committed with the lane. The operator's checkout's
// dependency folder is NEVER written. Accepted by the operator (Q11): the new package's code runs when
// the guard runs the tests.
//
// THE SAFETY RULE, in the order the code keeps it:
//   1. The link is removed BEFORE anything is installed — an install through the link would write
//      into the operator's real `node_modules`. `unlinkDependencyLink` removes only the link, by
//      `lstat`, with removers that cannot recurse; a link it cannot remove holds the lane instead.
//   2. The repository must IGNORE `node_modules/`, or the installed tree would ride into the lane's
//      commit; a repository that does not is held with that reason, before anything is installed.
//   3. On failure, a real `node_modules` is removed only when `lstat` proves it is a real directory
//      AND the install created it (there was a link or nothing there before) — with Node's recursive
//      remove, which unlinks any link inside rather than following it — and the link is put back so a
//      later cycle in the same worktree still runs. An aborted lane is never re-linked: its worktree may
//      already be on its way to `git worktree remove`, which follows a junction.
//   4. Only a LINKED worktree is ever worked on; a main checkout answers `{ changed: false }`.
//
// WHAT v1 DOES NOT HANDLE. Only a JavaScript manifest triggers this (npm / pnpm / yarn, picked from the
// root lockfile). A Python, Go or Rust manifest change — or a JS manifest in a repository with no root
// `package.json` — returns `{ changed: false }`, and the lane goes on exactly as it did before this
// module existed: the guard then judges the change against the dependencies the checkout already has.

import { lstat, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { runGit } from "@/lib/local/git";
import { discardWorktreeEdits } from "@/lib/local/lane-guard";
import {
  changedJsManifests,
  commandLine,
  firstMeaningfulLine,
  installCommand,
  managerFor,
  yarnMajor,
  type InstallCommand,
  type PackageManager,
} from "@/lib/local/lane-deps-detect";
import { spawnInstall, type SpawnInstall, type SpawnResult } from "@/lib/local/lane-deps-spawn";
import { ENGINE_INSTALL_DIR, isLinkedWorktree, relinkDependency, unlinkDependencyLink } from "@/lib/local/worktree-deps";

export interface DepsInstallInput {
  dir: string;
  /** The worktree HEAD before the session — the diff decides whether a manifest changed. */
  before: string;
  laneId: string;
  timeoutMs: number;
  signal?: AbortSignal;
}

export type DepsInstallOutcome =
  /** No manifest or lockfile changed — nothing to do. */
  | { changed: false }
  | { changed: true; ok: true; manager: string; note: string }
  /** The install failed or the ecosystem is unsupported. The implementation has ALREADY discarded the
   *  session's edits in the throwaway worktree; the lane commits nothing and is held with `note`. */
  | { changed: true; ok: false; manager: string | null; note: string };

/** The seams a test replaces: the process, and the worktree discard (lane-guard's, by default). */
export interface DepsInstallDeps {
  spawn: SpawnInstall;
  discard: (dir: string) => Promise<boolean>;
}

// Resolved at CALL time, not at module load: the lane's suites mock `lane-guard` without this export,
// and a module-load read of it would fail every one of them for a function they never reach.
const defaultDeps: DepsInstallDeps = { spawn: spawnInstall, discard: (dir) => discardWorktreeEdits(dir) };

/** `yarn --version` is a probe, not an install: it gets a short budget of its own. */
const YARN_PROBE_MS = 60_000;

const HELD_SUFFIX =
  " The session's edits were discarded in this throwaway worktree and the lane is held; the paired checkout's dependency folder was not touched.";

/** Every path the session changed against `before`: tracked edits (incl. deletions) plus new files the
 *  repository does not ignore. Null when git could not answer — which is treated as "nothing changed". */
async function changedPaths(dir: string, before: string): Promise<string[] | null> {
  if (!before.trim()) return null;
  const [diff, untracked] = await Promise.all([
    runGit(dir, ["diff", "--name-only", "-z", before, "--"]),
    runGit(dir, ["ls-files", "--others", "--exclude-standard", "-z"]),
  ]);
  if (!diff.ok || !untracked.ok) return null;
  return [...diff.stdout.split("\0"), ...untracked.stdout.split("\0")].filter(Boolean);
}

/**
 * Install the dependencies a session's JS manifest change needs, in the lane worktree, scripts off.
 * Never throws. See the header for the safety rule and what v1 leaves alone.
 */
export async function installChangedDependencies(input: DepsInstallInput, overrides: Partial<DepsInstallDeps> = {}): Promise<DepsInstallOutcome> {
  const deps: DepsInstallDeps = { ...defaultDeps, ...overrides };
  const { dir, before, timeoutMs, signal } = input;
  const changed = await changedPaths(dir, before);
  if (!changed || changedJsManifests(changed).length === 0) return { changed: false };
  const rootFiles = new Set(await readdir(dir).catch(() => [] as string[]));
  if (!rootFiles.has("package.json") || !(await isLinkedWorktree(dir))) return { changed: false };
  const manager = managerFor(rootFiles);
  const held = async (why: string): Promise<DepsInstallOutcome> => {
    await deps.discard(dir).catch(() => false);
    return { changed: true, ok: false, manager, note: `${why}${HELD_SUFFIX}` };
  };

  // NO TRAILING SLASH here, unlike `worktree-deps.ts`'s pre-link check: by this point
  // `isLinkedWorktree` has already proven `ENGINE_INSTALL_DIR` exists as the dependency SYMLINK, and
  // git's directory-only pattern match (`name/`) refuses to answer for a path "beyond a symbolic
  // link" — on Linux/macOS this is a fatal `check-ignore` error (exit 128, not just "not ignored"),
  // so the install was held on every run there (measured: git 2.45, Alpine). The bare form is exactly
  // what `linkDependencyDirs`/`ensureIgnoredAsFile` already proved ignorable — as a file/symlink, not
  // just as a directory — before this link was ever created.
  if (!(await runGit(dir, ["check-ignore", "-q", "--", ENGINE_INSTALL_DIR])).ok) {
    return held(
      `Held: this repository does not ignore ${ENGINE_INSTALL_DIR}/, so installing the changed manifest's dependencies would put the whole dependency tree into the lane's commit.`,
    );
  }
  const unlinked = await unlinkDependencyLink(dir, ENGINE_INSTALL_DIR);
  if (unlinked.outcome === "failed") {
    return held(
      `Held: the worktree's ${ENGINE_INSTALL_DIR} link to the paired checkout could not be removed, so an install would have written into the operator's own dependency folder.`,
    );
  }
  // "removed" or "absent": whatever real tree exists after the install, this install made it.
  const created = unlinked.outcome !== "not-a-link";

  const resolved = await resolveCommand(manager, dir, deps.spawn, signal);
  const run = "cmd" in resolved ? await deps.spawn(resolved.cmd, { cwd: dir, timeoutMs, signal }) : resolved.probe;
  const line = "cmd" in resolved ? commandLine(resolved.cmd) : `${manager} --version`;
  if ("cmd" in resolved && run.code === 0 && !run.timedOut && !run.aborted && !run.spawnError) {
    return {
      changed: true,
      ok: true,
      manager,
      note: `Installed dependencies for the changed manifest with ${manager}, scripts disabled — the guard verifies against them.`,
    };
  }

  const aborted = run.aborted || signal?.aborted === true;
  if (!aborted) await deps.discard(dir).catch(() => false);
  const restoreNote = await restoreDependencyLink(dir, created, unlinked.target, aborted, signal);
  return { changed: true, ok: false, manager, note: `${failureWhy(line, run, timeoutMs)}${HELD_SUFFIX}${restoreNote}` };
}

/** The install command — for yarn, after asking the worktree's own yarn which major it is. */
async function resolveCommand(
  manager: PackageManager,
  dir: string,
  spawn: SpawnInstall,
  signal: AbortSignal | undefined,
): Promise<{ cmd: InstallCommand } | { probe: SpawnResult }> {
  if (manager !== "yarn") return { cmd: installCommand(manager) };
  const probe = await spawn({ command: "yarn", args: ["--version"], env: {} }, { cwd: dir, timeoutMs: YARN_PROBE_MS, signal });
  const major = probe.code === 0 ? yarnMajor(probe.output) : null;
  return major == null ? { probe: probe.code === 0 ? { ...probe, code: 1 } : probe } : { cmd: installCommand("yarn", major) };
}

function failureWhy(line: string, run: SpawnResult, timeoutMs: number): string {
  if (run.aborted) return `Dependency install stopped: \`${line}\` was cut short because the lane was stopped.`;
  if (run.timedOut) return `Dependency install failed: \`${line}\` did not finish within ${Math.max(1, Math.round(timeoutMs / 60_000))} min and was stopped.`;
  if (run.spawnError) return `Dependency install failed: could not run \`${line}\` (${run.spawnError}) — is it installed on this machine?`;
  const first = firstMeaningfulLine(run.output);
  return `Dependency install failed: \`${line}\` exited ${run.code ?? "abnormally"}${first ? ` — ${first}` : ""}.`;
}

/**
 * After a failed install: clear the real tree THIS install created, then put the link back. Returns a
 * sentence for the lane note only when the link could not be restored.
 */
async function restoreDependencyLink(
  dir: string,
  created: boolean,
  target: string | null,
  aborted: boolean,
  signal: AbortSignal | undefined,
): Promise<string> {
  const path = join(dir, ENGINE_INSTALL_DIR);
  if (created) {
    const info = await lstat(path).catch(() => null);
    // lstat PROVES a real directory before a recursive remove is allowed near it — and Node's recursive
    // remove unlinks a link it meets inside the tree rather than following it (worktree-deps.links.test).
    if (info?.isDirectory() && !info.isSymbolicLink()) await rm(path, { recursive: true, force: true, maxRetries: 3 }).catch(() => undefined);
  }
  if (!target || aborted) return "";
  if (!(await relinkDependency(dir, target, ENGINE_INSTALL_DIR))) {
    return ` The link to the paired checkout's ${ENGINE_INSTALL_DIR} could not be restored, so a later cycle in this worktree verifies without it.`;
  }
  // The lane may have been cut while the link was being made; a cut lane's worktree is headed for
  // teardown, and a link must not be there when git gets to it.
  if (signal?.aborted) await unlinkDependencyLink(dir, ENGINE_INSTALL_DIR);
  return "";
}
