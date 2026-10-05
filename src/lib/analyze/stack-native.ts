// Stack-native evidence for D6 and D8: the forms a C#, C++, Kotlin, Swift or Java repo carries for the
// same practice a JS repo expresses with `.eslintrc` or `evals/`.
//
// Why a separate module: the D6/D8 point tables were keyed to JS conventions, so a Unity, Unreal or
// Gradle repo could not earn the linter or formatter award even when it HAD one, and an improvement
// loop that added `.clang-format` or detekt could never close the gap it was asked to close (game-repo
// investigation, 2026-10-05). Nothing here adds a row: each form feeds an award that already exists.
// Real gaps stay gaps: a repo with none of these forms scores exactly what it scored before.
//
// Every matcher runs on the lowercased tree paths. Only `buildFileZeroWarning` reads content, and only
// from files the scan fetched (see its note).

/** Third-party trees. A vendored library's `.clang-format` describes that library, not this repo. */
const THIRD_PARTY = /(^|\/)(node_modules|vendors?|third[-_]?party|external|extern|\.venv)\//i;
export const isThirdParty = (p: string): boolean => THIRD_PARTY.test(p);

/** First own (non-third-party) path matching any of `res`, in regex order: the `idx.first` contract. */
export function firstOwn(paths: readonly string[], res: readonly RegExp[]): string | undefined {
  for (const re of res) {
    const hit = paths.find((p) => re.test(p) && !isThirdParty(p));
    if (hit) return hit;
  }
  return undefined;
}

/** Stack-native LINTER configs (the D6 20-point award). C# analyzers count: `.globalconfig`,
 *  `stylecop.json` and `*.ruleset` are how .NET turns analyzer warnings into a policy. */
export const NATIVE_LINTER_PATHS: readonly RegExp[] = [
  /(^|\/)\.clang-tidy$/,
  /(^|\/)detekt(-config)?\.ya?ml$/,
  /(^|\/)config\/detekt\/[^/]+\.ya?ml$/,
  /(^|\/)\.ktlint[^/]*$/,
  /(^|\/)(\.globalconfig|stylecop\.json)$/,
  /\.ruleset$/,
  /(^|\/)\.swiftlint\.ya?ml$/,
  /(^|\/)checkstyle\.xml$/,
  /(^|\/)config\/checkstyle\/[^/]+$/,
];

/** The same linters declared as a build PLUGIN rather than a config file, matched in fetched build text
 *  (`build.gradle` via the manifest blob, root `build.gradle.kts` read beside it, `pom.xml`). */
export const NATIVE_LINTER_BUILD_TEXT = /ktlint|detekt|checkstyle/;

/** Stack-native FORMATTER configs (the D6 10-point award), tried before `.editorconfig` so the citation
 *  names the stronger file. One award either way: nothing is counted twice. */
export const NATIVE_FORMATTER_PATHS: readonly RegExp[] = [/(^|\/)\.clang-format$/, /(^|\/)\.swift-format$/];

/** Build files that can carry a compiler-level zero-warning switch. */
const BUILD_FILE = /(^|\/)(directory\.build\.props|[^/]+\.csproj|build\.gradle(\.kts)?|[^/]+\.(build|target)\.cs)$/i;
/** MSBuild `<TreatWarningsAsErrors>true`, Kotlin `allWarningsAsErrors`, Android lint `warningsAsErrors`,
 *  Unreal `bWarningsAsErrors = true` / `DefaultWarningLevel = WarningLevel.Error`. Matched lowercased. */
const BUILD_ZERO_WARNING =
  /<treatwarningsaserrors>\s*true\s*<|allwarningsaserrors\s*(=|\.set\(|:)\s*true|\bwarningsaserrors\s*(=|\.set\()?\s*true|\bbwarningsaserrors\s*=\s*true|defaultwarninglevel\s*=\s*warninglevel\.error/;
/** Comments out, so a commented-out switch is not read as an active one. */
const stripComments = (text: string) =>
  text.replace(/<!--[\s\S]*?-->/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

/**
 * The first FETCHED build file that turns compiler warnings into errors, or undefined.
 *
 * Content-bound, so it sees only what the scan fetched: root `build.gradle`, root `build.gradle.kts`
 * and root `Directory.Build.props` are exact-name fetches (forge/source-selection.ts); a `.csproj` is
 * never fetched; an Unreal `*.Build.cs` / `*.Target.cs` only when the source sample happens to pick it.
 * An unfetched file is silence here, never a guess.
 */
export function buildFileZeroWarning(files: readonly { path: string; content: string }[]): string | undefined {
  return files.find((f) => BUILD_FILE.test(f.path) && !isThirdParty(f.path) && BUILD_ZERO_WARNING.test(stripComments(f.content.toLowerCase())))?.path;
}

/**
 * An LLM-as-judge eval harness (the D8 30-point eval award), from the tree alone.
 *
 * Needs TWO independent kinds of evidence, never one. "judge" is a domain word too (a courts app has
 * `judge.ts` and a `judges/` folder), so a judge-named file and a `judges/` directory are ONE kind,
 * the same token twice; a rubric and a UAT verdict are the other two. Returns the cited files, one per
 * kind, when at least two kinds are present.
 */
export function judgeHarness(paths: readonly string[]): string[] | undefined {
  const own = paths.filter((p) => !isThirdParty(p));
  const judge = own.find((p) => /(^|\/)[^/]*judge[^/]*\.(py|js|mjs|cjs|ts)$/.test(p) || /(^|\/)judges?\//.test(p));
  const rubric = own.find((p) => /(^|\/)[^/]*rubric[^/]*\.(py|md|json|ya?ml)$/.test(p));
  const uat = own.find((p) => /(^|\/)uat\/(.+\/)?[^/]*(rubric|verdict)[^/]*\.[a-z0-9]+$/.test(p) && p !== rubric);
  const kinds = [judge, rubric, uat].filter((p): p is string => Boolean(p));
  return kinds.length >= 2 ? kinds : undefined;
}

/**
 * A task-card queue (the D8 issue-template analogue): at least three `.md` cards directly inside one
 * `tasks/`, `cards/` or `queue/` directory. Docs trees are excluded by the caller's NONCORE filter
 * (a docs site's `docs/tasks/` is how-to prose, not work an agent picks up). Returns the directory.
 */
export function taskCardQueue(paths: readonly string[]): string | undefined {
  const byDir = new Map<string, number>();
  for (const p of paths) {
    const m = /^(.*(?:^|\/)(?:tasks|cards|queue))\/([^/]+)\.md$/.exec(p);
    if (!m || m[2] === "readme" || isThirdParty(p)) continue;
    byDir.set(m[1]!, (byDir.get(m[1]!) ?? 0) + 1);
  }
  for (const [dir, n] of byDir) if (n >= 3) return `${dir}/ (${n} cards)`;
  return undefined;
}

/** Versioned agent guardrails: a hook/permission config an agent runtime enforces on every session.
 *  The project-wide files only: `.claude/settings.local.json` is personal and does not count. */
export const AGENT_GUARDRAIL_PATHS: readonly RegExp[] = [/^\.agents\/hooks\.json$/, /^\.claude\/settings\.json$/];
