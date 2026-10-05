// THE GUARD'S LAST RESORT: a toolchain check DETECTED on disk, for a repository that declares none.
//
// WHY IT EXISTS. `resolveVerifyCommand` reads what a repository DECLARES — the manifest, the guidance
// files, `package.json`. On a non-JS repository every one of those is silent, so the verdict was
// `skipped` and the standing runner could never land anything there. Measured 2026-10-05:
// `xkazm04/firetv` has a Gradle wrapper and a pure-JVM `core/` module whose 79 unit tests pass in
// ~30 s with no device; `xkazm04/garden-vr` has a real .NET solution whose 195 tests pass in ~40 s.
// Both repositories carry a fast, headless proof of themselves that the guard simply could not see.
//
// THIS IS THE RESOLVER'S SECOND LICENSED INVENTION (the first is `npx tsc --noEmit`, licensed by a
// `tsconfig.json`). It is licensed the same way: by concrete evidence on disk, never by a guess about
// what a repository "probably" runs. And it is held to three rules:
//   1. It ranks strictly BELOW every declared source — `resolveVerifyCommand` consults it last.
//   2. Its `source` says it was DETECTED and names the evidence, so no surface can render it as
//      something the repository asked for.
//   3. It is CONSERVATIVE: only a toolchain whose check runs headless from a clean checkout. No
//      Unity batchmode, no Unreal build, no CMake, no pytest — each needs an editor, a licence, a
//      device or an environment a worktree does not carry, and a check that cannot establish a
//      baseline is worse than none (it costs every lane its timeout to say `baseline-unavailable`).
//
// TRACKED FILES ONLY. Detection reads `git ls-files`, because a lane worktree contains exactly the
// tracked files — evidence that exists only in the operator's checkout (Unity's GENERATED, untracked
// `.sln`/`.csproj`, a stray `build/`) licenses nothing the worktree can run.

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { runGit } from "@/lib/local/git";

/** A detected check, shaped exactly like the resolver's own provenance pair. */
export interface ToolchainCheck {
  command: string;
  /** Always starts `detected: ` and names what licensed it. */
  source: string;
}

/** Hard ceiling on the paths considered. The `git ls-files` pathspecs below already narrow the
 *  listing to the handful of shapes detection reads; a listing that still overflows this is refused
 *  whole rather than read in part, because a truncated list can drop exactly the evidence that VETOES
 *  a match (a Unity project's `ProjectSettings/`) while keeping the file that suggested it. */
export const MAX_TOOLCHAIN_PATHS = 20_000;

/** Deepest directory a solution may sit in, and the fallback walk's depth. */
const MAX_DEPTH = 3;
/** Gradle modules run together at most — the guard's budget is ten minutes, not a full build. */
const MAX_GRADLE_MODULES = 3;

const norm = (p: string): string => p.replace(/\\/g, "/").replace(/^\.\//, "");
const dirOf = (p: string): string => (p.includes("/") ? p.slice(0, p.lastIndexOf("/") + 1) : "");
const baseOf = (p: string): string => p.slice(p.lastIndexOf("/") + 1);

/** The top-level project names a `settings.gradle(.kts)` includes (`include(":core")`,
 *  `include ':a', ':b'`). Nested paths (`:libs:x`) are dropped: detection only ever names a top-level
 *  module, and a module the settings never include is a `:x:test` Gradle would reject. */
export function gradleIncludes(settings: string): string[] {
  const out: string[] = [];
  for (const line of settings.split(/\r?\n/)) {
    if (!/^\s*include\b/.test(line)) continue;
    for (const m of line.matchAll(/["']:?([A-Za-z0-9_.-]+)["']/g)) if (m[1]) out.push(m[1]);
  }
  return out;
}

function gradleCheck(files: ReadonlySet<string>, paths: readonly string[], platform: NodeJS.Platform, includes: readonly string[] | null): ToolchainCheck | null {
  const settings = files.has("settings.gradle.kts") ? "settings.gradle.kts" : files.has("settings.gradle") ? "settings.gradle" : null;
  // The wrapper jar is what makes `gradlew` runnable from a clean checkout; without it the script
  // only prints an error. On Windows the `.bat` is the script cmd.exe can actually run.
  if (!settings || !files.has("gradlew") || !files.has("gradle/wrapper/gradle-wrapper.jar")) return null;
  if (platform === "win32" && !files.has("gradlew.bat")) return null;
  // A PURE-JVM module — tests tracked, no Android manifest — runs without an Android SDK, which is
  // the difference between seconds on any box and a hard failure on most of them.
  const modules = new Set<string>();
  for (const p of paths) {
    const mod = /^([^/]+)\/src\/test\//.exec(p)?.[1];
    if (mod && !files.has(`${mod}/src/main/AndroidManifest.xml`) && (!includes || includes.includes(mod))) modules.add(mod);
  }
  const chosen = modules.has("core") ? ["core"] : [...modules].sort().slice(0, MAX_GRADLE_MODULES);
  const tasks = chosen.length ? chosen.map((m) => `:${m}:test`).join(" ") : "test";
  // `.\` and not a bare name: cmd.exe does not search the cwd when NoDefaultCurrentDirectoryInExePath
  // is set (it is, in a Claude Code session), and `gradlew.bat` then "is not recognized".
  const wrapper = platform === "win32" ? ".\\gradlew.bat" : "./gradlew";
  const scope = chosen.length ? ` (pure-JVM ${chosen.map((m) => `:${m}`).join(", ")})` : "";
  return { command: `${wrapper} ${tasks} --console=plain --no-daemon`, source: `detected: Gradle wrapper + ${settings}${scope}` };
}

function dotnetCheck(paths: readonly string[]): ToolchainCheck | null {
  const slns = paths.filter((p) => p.endsWith(".sln") && p.split("/").length - 1 <= MAX_DEPTH).sort();
  for (const sln of slns) {
    const dir = dirOf(sln);
    const under = paths.filter((p) => p.startsWith(dir));
    // An ENGINE-generated solution is not a test harness: Unity's needs the editor, Unreal's a full
    // engine build. Either marker beside the solution vetoes it.
    if (under.some((p) => p.startsWith(`${dir}ProjectSettings/`) || p.startsWith(`${dir}Assets/`))) continue;
    if (under.some((p) => dirOf(p) === dir && p.endsWith(".uproject"))) continue;
    const tests = under.find((p) => p.endsWith(".csproj") && /test/i.test(baseOf(p)));
    if (!tests) continue;
    return { command: `dotnet test "${sln}" --nologo`, source: `detected: ${sln} with a *Tests project (${baseOf(tests)})` };
  }
  return null;
}

/**
 * PURE: the toolchain check a list of repository paths licenses — AT MOST ONE, the first rule that
 * applies, in order: Gradle, .NET, Cargo, Go. Paths are repo-relative (either separator); a trailing
 * `/` marks a directory (the fs fallback emits those). `gradleSettings` is the settings file's text
 * when it was readable, used only to keep a module the build never includes from being named.
 */
export function toolchainChecksFromPaths(
  rawPaths: readonly string[],
  platform: NodeJS.Platform,
  gradleSettings: string | null = null,
): ToolchainCheck[] {
  if (rawPaths.length > MAX_TOOLCHAIN_PATHS) return [];
  const paths = rawPaths.map(norm).filter(Boolean);
  const files = new Set(paths);
  const found =
    gradleCheck(files, paths, platform, gradleSettings ? gradleIncludes(gradleSettings) : null) ??
    dotnetCheck(paths) ??
    (files.has("Cargo.toml") ? { command: "cargo test", source: "detected: Cargo.toml at the root" } : null) ??
    (files.has("go.mod") ? { command: "go test ./...", source: "detected: go.mod at the root" } : null);
  return found ? [found] : [];
}

/** Every shape detection reads, as `git ls-files` pathspecs — so even a vast Unity tree lists a few
 *  dozen paths, not its hundred thousand assets. `:(glob)` `*` stops at `/`, which is what keeps the
 *  `Assets/` probe to that folder's direct children. */
const PATHSPECS: readonly string[] = [
  "gradlew", "gradlew.bat", "settings.gradle", "settings.gradle.kts", "gradle/wrapper/gradle-wrapper.jar",
  "Cargo.toml", "go.mod", "*.sln", "*.csproj", "*.uproject",
  ":(glob)*/src/test/**", ":(glob)*/src/main/AndroidManifest.xml",
  ":(glob)**/ProjectSettings/*", ":(glob)**/Assets/*",
];

/** Directories the fallback walk never enters: VCS state, dependency caches and build output. */
const SKIP_DIRS = new Set(["node_modules", ".git", "Library", "Temp", "build", "bin", "obj", ".gradle"]);

/** The fallback when git cannot list the tree: a bounded walk (depth <= 3). It can see untracked
 *  files git would have hidden, which is why the engine vetoes above do not rely on tracking. */
async function walk(root: string): Promise<string[]> {
  const out: string[] = [];
  const visit = async (rel: string, depth: number): Promise<void> => {
    if (out.length > MAX_TOOLCHAIN_PATHS) return;
    const entries = await readdir(path.join(root, rel), { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      const p = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        out.push(`${p}/`);
        if (depth < MAX_DEPTH) await visit(p, depth + 1);
      } else out.push(p);
    }
  };
  await visit("", 0);
  return out;
}

/**
 * IO: the detected check for the repository at `dir`, or `[]`. Never throws — detection failing is
 * the same fact as detection finding nothing, and the guard reports both as "no check declared".
 */
export async function detectToolchainChecks(dir: string): Promise<ToolchainCheck[]> {
  try {
    const listed = await runGit(dir, ["ls-files", "-z", "--", ...PATHSPECS]);
    const paths = listed.ok ? listed.stdout.split("\0").filter(Boolean) : await walk(dir);
    const settingsRel = paths.includes("settings.gradle.kts") ? "settings.gradle.kts" : "settings.gradle";
    const settings = await readFile(path.join(dir, settingsRel), "utf8").catch(() => null);
    return toolchainChecksFromPaths(paths, process.platform, settings);
  } catch {
    return [];
  }
}
