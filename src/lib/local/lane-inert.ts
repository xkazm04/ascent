// INERT PATHS — the files no build, test, lint or CI step executes or reads, so a diff made only of
// them cannot make the repository's checks worse.
//
// WHY THIS EXISTS. The degradation guard asks one question: did the repository's own checks get worse?
// On a repository where no check resolves (`skipped`), or where none passes in the lane's worktree
// (`baseline-unavailable`), it cannot run the experiment — and a runner that lands only `verified`
// lanes then cannot improve that repository at all, even with a pull-request template. For a diff
// whose every path is inert the question is answered BY CONSTRUCTION: nothing a check reads changed,
// so there is nothing for it to regress on. `verifyResult` upgrades exactly those two verdicts, and
// says in the note that the checks were not run.
//
// CONSERVATIVE BY DESIGN: a path is inert only when it is positively known to be documentation or a
// declaration nothing executes. A false "inert" lands an unchecked change that a build reads; a false
// "not inert" costs one lane its delivery. The asymmetry decides every edge case below — when in
// doubt, NOT inert. So: anything inside a source, test, fixture or content tree is out (text there is
// build input — `include_str!`, `//go:embed`, a `?raw` import, an embedded resource, a test fixture, a
// site generator's validated frontmatter), as are dotfiles (they configure tools), CI and hook
// directories (they execute), and every script, source, manifest and lockfile.
//
// `rejected` IS NEVER UPGRADED, and nothing here could do it: inertness is consulted only where no
// comparison was possible. A measured pass→fail is evidence, and a theory about paths does not outrank
// a measurement.
//
// THE RESIDUE, stated rather than hidden. A path rule cannot see inside a file: a Rust crate that
// includes its README as crate docs runs that README's code fences as doctests, and `pytest
// --doctest-glob` does the same for prose. Those are checks the guard would have run had it been able
// to; the upgrade fires only where it could not.

/** Prose. Inert anywhere outside the build-input trees below. */
const PROSE_EXT = new Set(["md", "txt", "rst"]);
/** What `docs/` may carry beyond prose: MDX (JSX — inert only under `docs/`) and images. */
const DOCS_EXT = new Set(["md", "mdx", "txt", "rst", "png", "jpg", "jpeg", "svg", "gif", "webp"]);
/** Agent-facing declarations under `.ai/` — read by agents and by Ascent, never by the build. */
const AI_EXT = new Set(["md", "yaml", "yml", "json", "txt"]);
/** Issue-form definitions: GitHub renders them; nothing runs them. */
const ISSUE_TEMPLATE_EXT = new Set(["md", "yml", "yaml"]);

/**
 * Directories whose files are BUILD OR TEST INPUT whatever their extension. Matched on any directory
 * segment, lowercased. `assets`/`resources`/`streamingassets` are the Unity, .NET and JVM trees code
 * loads at runtime; the test and fixture names mirror the integrity guard's (`lane-gate-diff.ts`).
 */
const INPUT_DIRS = new Set([
  "src", "source", "sources", "lib", "app", "include", "internal", "cmd", "pkg",
  "assets", "resources", "streamingassets",
  "test", "tests", "__tests__", "spec", "specs", "e2e", "cypress",
  "fixture", "fixtures", "__fixtures__", "testdata", "test-data", "__snapshots__", "snapshots",
  "__mocks__", "mocks", "golden", "goldens", "baselines",
  "content", "pages", "posts", "_posts", "blog",
  // Executes: commit hooks and CI definitions that do not live under `.github/workflows/`.
  "hooks", ".husky", ".githooks", ".circleci", ".gitlab",
]);

/** Script, source and build-description extensions — never inert, under any directory. */
const CODE_EXT = new Set([
  "js", "jsx", "ts", "tsx", "mjs", "cjs", "mts", "cts", "vue", "svelte", "astro",
  "py", "pyw", "rb", "php", "pl", "lua", "r", "jl", "ex", "exs", "erl", "clj", "dart", "swift",
  "sh", "bash", "zsh", "fish", "ps1", "psm1", "bat", "cmd",
  "cs", "csx", "csproj", "sln", "props", "targets", "vb", "fs", "fsproj",
  "c", "cc", "cpp", "cxx", "h", "hh", "hpp", "hxx", "m", "mm", "uplugin", "uproject",
  "kt", "kts", "java", "gradle", "groovy", "scala", "go", "rs",
  "cmake", "mk", "bzl", "toml", "ini", "cfg", "lock", "xml",
]);

/** Build declarations wearing a prose or declaration extension. */
const BUILD_BASENAME = /^((requirements|constraints)([-._][a-z0-9._-]*)?\.txt|cmakelists\.txt|runtime\.txt|package(-lock)?\.json|pnpm-(lock|workspace)\.ya?ml|composer\.json|tsconfig[^/]*\.json)$/;

const LICENSE_BASENAME = /^(licen[cs]e|copying|notice)([-.][a-z0-9-]+)?(\.(md|txt|rst))?$/;

/** Forward slashes, no leading `./` or `/`, lowercased; `null` for anything not a plain relative path. */
function normalise(raw: string): string | null {
  const p = raw.trim().replace(/\\/g, "/").replace(/^(\.\/)+/, "").replace(/^\/+/, "").toLowerCase();
  if (!p || p.endsWith("/")) return null;
  // A path that climbs or self-refers is not one git reports for a change; refusing it is cheaper
  // than reasoning about where it lands.
  if (p.split("/").some((s) => s === ".." || s === "." || s === "")) return null;
  return p;
}

/** True only when `path` is documentation or a declaration no build, test, lint or CI step reads. */
export function isInertPath(path: string): boolean {
  const p = typeof path === "string" ? normalise(path) : null;
  if (!p) return false;
  const segs = p.split("/");
  const base = segs.at(-1)!;
  const dirs = segs.slice(0, -1);
  const dot = base.lastIndexOf(".");
  const ext = dot > 0 ? base.slice(dot + 1) : "";

  // ── NEVER, whatever else matches.
  if (CODE_EXT.has(ext) || BUILD_BASENAME.test(base)) return false;
  // A dotfile configures a tool (`.editorconfig`, `.prettierrc.json`, `.markdownlint.yaml`,
  // `.gitignore`) — and a lint or format config changes what the checks report.
  if (base.startsWith(".")) return false;
  // `docs/assets/` is where documentation keeps its images; everywhere else `assets` is build input.
  if (dirs.some((d, i) => INPUT_DIRS.has(d) && !(d === "assets" && dirs[0] === "docs" && i > 0))) return false;
  // CI and the actions it calls execute; `.claude/settings*.json` registers hooks that execute.
  for (let i = 0; i < dirs.length - 1; i += 1) {
    if (dirs[i] === ".github" && (dirs[i + 1] === "workflows" || dirs[i + 1] === "actions")) return false;
  }
  if (dirs.includes(".claude") && /^settings.*\.json$/.test(base)) return false;

  // ── INERT, by kind.
  if (base === "codeowners") return true;
  if (LICENSE_BASENAME.test(base)) return true;
  if (dirs[0] === ".github" && dirs[1] === "issue_template") return ISSUE_TEMPLATE_EXT.has(ext);
  if (dirs[0] === ".ai") return AI_EXT.has(ext);
  if (dirs[0] === "docs") return DOCS_EXT.has(ext);
  // Pull-request templates are `.md` and fall here, wherever GitHub looks for them.
  return PROSE_EXT.has(ext);
}

/** True when there is at least one path and every one is inert. An empty diff proves nothing. */
export function allInert(paths: readonly string[] | null | undefined): boolean {
  return Array.isArray(paths) && paths.length > 0 && paths.every((p) => isInertPath(p));
}

/**
 * ISOLATED: a path no existing build, test or lint can reach even when it is code — the agent-facing
 * declaration trees (`.ai/`, `.github/`, `.claude/{skills,agents,commands}/`) plus everything inert.
 * Meaningful ONLY for a file the diff ADDED (an install never overwrites): a NEW script under `.ai/` is
 * imported by nothing that exists, and a NEW workflow adds a CI job without touching an existing check.
 * A modified file under the same trees is not isolated (an existing workflow IS a gate). Hooks
 * directories and `.claude/settings*.json` execute code on every session and are never isolated.
 */
export function isIsolatedPath(path: string): boolean {
  if (isInertPath(path)) return true;
  const segs = path.replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase().split("/").filter(Boolean);
  if (segs.length < 2 || segs.slice(0, -1).includes("hooks")) return false;
  if (segs[0] === ".ai" || segs[0] === ".github") return true;
  return segs[0] === ".claude" && ["skills", "agents", "commands"].includes(segs[1]!);
}

/** True when there is at least one path and every one is isolated. Callers pass ADDED paths only. */
export function allIsolated(paths: readonly string[] | null | undefined): boolean {
  return Array.isArray(paths) && paths.length > 0 && paths.every((p) => isIsolatedPath(p));
}
