// DEPENDENCY LANES, pure half — which paths count as a JavaScript manifest change, which package
// manager a repository uses, the exact argv each one is run with (scripts OFF), and the line of a
// failed install worth quoting. No filesystem, no git, no process: `lane-deps-install.ts` gathers the
// facts and this module decides, so every rule here is table-testable.

/** The files whose change means "the dependency tree this worktree runs against is out of date". */
export const JS_MANIFEST_NAMES: readonly string[] = ["package.json", "package-lock.json", "npm-shrinkwrap.json", "pnpm-lock.yaml", "yarn.lock"];

export type PackageManager = "npm" | "pnpm" | "yarn";

/**
 * The changed paths that are a JS manifest or lockfile — at ANY depth (a workspace package's
 * `package.json` counts), but never under a `node_modules/` segment, whose `package.json` files are
 * installed state, not the repository's declaration. Repo-relative, `/`-separated, sorted, unique.
 * A Python, Go or Rust manifest is deliberately NOT in the list: those ecosystems are not handled in
 * v1, and a change to one leaves the lane exactly as it was before this module existed.
 */
export function changedJsManifests(paths: readonly string[]): string[] {
  const hits = new Set<string>();
  for (const raw of paths) {
    const p = raw.trim().replace(/\\/g, "/").replace(/^\.\//, "");
    if (!p) continue;
    const segments = p.split("/");
    if (segments.includes("node_modules")) continue;
    if (JS_MANIFEST_NAMES.includes(segments[segments.length - 1]!)) hits.add(p);
  }
  return [...hits].sort();
}

/**
 * The package manager, from the lockfile at the REPOSITORY ROOT: `package-lock.json` (or
 * `npm-shrinkwrap.json`) → npm, `pnpm-lock.yaml` → pnpm, `yarn.lock` → yarn, none → npm. Checked in
 * that order, so a root that carries two lockfiles resolves to the first. The root decides even when
 * the changed manifest is a nested workspace package's: workspaces resolve and install at the root.
 */
export function managerFor(rootFiles: ReadonlySet<string>): PackageManager {
  if (rootFiles.has("package-lock.json") || rootFiles.has("npm-shrinkwrap.json")) return "npm";
  if (rootFiles.has("pnpm-lock.yaml")) return "pnpm";
  if (rootFiles.has("yarn.lock")) return "yarn";
  return "npm";
}

export interface InstallCommand {
  command: string;
  args: string[];
  /** Added to the inherited environment. Belt beside the flags, never a replacement for them. */
  env: Record<string, string>;
}

/**
 * The install, scripts disabled, for each manager.
 *
 *   npm   `install`, NOT `ci`: the agent could edit `package.json` but could not update the lockfile,
 *         and `ci` refuses exactly that mismatch. `--ignore-scripts` covers the root's own lifecycle
 *         scripts and every dependency's; `--no-audit --no-fund` keep it off the network beyond the
 *         registry fetch itself.
 *   pnpm  `--ignore-scripts`, plus `--no-frozen-lockfile`, because pnpm freezes the lockfile by default
 *         whenever `CI` is set in the inherited environment — which would refuse the very change.
 *   yarn  classic (1.x): `--ignore-scripts --non-interactive`. Berry (2+): `--mode=skip-build`, which
 *         skips every build script, plus `--no-immutable` for the same CI default as pnpm's.
 *         `yarnMajor` comes from `yarn --version` run in the worktree, so a repository pinning berry
 *         through `packageManager`/`yarnPath` is read correctly.
 */
export function installCommand(manager: PackageManager, yarnMajorVersion: number | null = null): InstallCommand {
  if (manager === "pnpm") {
    return { command: "pnpm", args: ["install", "--ignore-scripts", "--no-frozen-lockfile"], env: { npm_config_ignore_scripts: "true" } };
  }
  if (manager === "yarn") {
    return yarnMajorVersion != null && yarnMajorVersion >= 2
      ? { command: "yarn", args: ["install", "--mode=skip-build", "--no-immutable"], env: { YARN_ENABLE_SCRIPTS: "false", YARN_ENABLE_IMMUTABLE_INSTALLS: "false" } }
      : { command: "yarn", args: ["install", "--ignore-scripts", "--non-interactive"], env: {} };
  }
  return { command: "npm", args: ["install", "--ignore-scripts", "--no-audit", "--no-fund"], env: { npm_config_ignore_scripts: "true" } };
}

/** The major version out of `yarn --version` output, or null when there is none to read. */
export function yarnMajor(versionOutput: string): number | null {
  const m = versionOutput.match(/^\s*(\d+)\.\d+/m);
  return m ? Number(m[1]) : null;
}

/** The command line as a human reads it in a lane note. */
export const commandLine = (cmd: InstallCommand): string => [cmd.command, ...cmd.args].join(" ");

const ANSI = /\x1b\[[0-9;]*[A-Za-z]/g;
const ERRORISH = /\b(error|err!|enoent|eresolve|etarget|e404|e40\d|not found|not recognized|cannot find|failed|unable)\b/i;
/** `npm error code E404` is a label; the NEXT error line says what was not found. */
const LABEL_ONLY = /^(npm (error|ERR!)|ERR_PNPM_\w+)?\s*code\s+\S+$/i;
const MAX_LINE = 300;

/**
 * The first line of a failed install worth putting in front of the operator: the first error-shaped
 * line that is not a bare code label, else the first non-empty line. Colour codes stripped, bounded.
 */
export function firstMeaningfulLine(output: string): string | null {
  const lines = output
    .replace(ANSI, "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const pick = lines.find((l) => ERRORISH.test(l) && !LABEL_ONLY.test(l)) ?? lines[0];
  return pick ? pick.slice(0, MAX_LINE) : null;
}
