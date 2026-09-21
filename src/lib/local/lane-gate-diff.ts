// THE INTEGRITY GUARD — a lane may not edit the surface that scores it.
//
// Every measurement elsewhere in this system assumes the instrument is read-only to the thing being
// measured. An agent candidate voids that assumption in a way no previous system under test did,
// because it holds the same shell the harness holds: it can read the verify command, edit a test,
// relax a fixture, and then score a clean lift for having done nothing. The prohibition ("do not
// weaken the tests") does not work and cannot, because it is unfalsifiable at the only place it would
// have to be checked — inside a loop nobody is reading — and this loop is explicitly unattended.
//
// So the corrective is structural: before a lift is credited, diff the lane's own commits against the
// scoring surface. A lane that touched it is recorded VOID WITH ITS REASON and excluded from the
// metric, and the void is REPORTED AS AN OUTCOME rather than dropped — a silently discarded void lane
// flatters the arm that produced it, which is the failure this guard exists to prevent.
//
// This extends the shape `checkPlanFence` already established (pure git-diff analysis over a lane's
// commits) rather than inventing a second mechanism.
//

/** Why a lane was voided. Printed verbatim in the ledger beside the lane. */
export interface VoidVerdict {
  void: boolean;
  /** Null when not void. */
  reason: string | null;
  /** The paths that triggered it, bounded for display. Empty when not void. */
  paths: string[];
}

/**
 * The classes of file whose change can flatter a verdict.
 *
 * Deliberately a classifier rather than a path list: a repo's test layout is its own, and a list
 * maintained here is a list that goes stale the first time a directory is renamed — which would turn
 * the guard off silently, in a voice indistinguishable from "nothing was touched".
 */
export type ScoringSurface = "verify-command" | "test-file" | "fixture" | "gate-config";

/** How many offending paths the verdict prints. The rest are counted, never hidden. */
const MAX_REPORTED_PATHS = 6;

/** Normalize a git path for matching: forward slashes, no leading `./`, lowercased. Git already
 *  reports forward slashes, but a caller that built a path with `node:path` on Windows would not. */
function norm(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "").toLowerCase();
}

const segments = (p: string): string[] => p.split("/").filter(Boolean);
const base = (p: string): string => segments(p).at(-1) ?? "";

/**
 * A TEST FILE by NAME, in any of the shapes the ecosystems this loop drives actually use.
 * `foo.test.ts`, `foo.spec.tsx`, `foo.e2e.test.mts`, `test_foo.py`, `foo_test.go`, `FooTest.java`.
 */
const TEST_BASENAME = /(^|[.\-_])(test|spec)s?\.[cm]?[jt]sx?$|^test_.+\.py$|_test\.(py|go|rb|exs?)$|test\.(java|kt|cs)$/;

/** A DIRECTORY whose whole purpose is tests. Matched on a path SEGMENT, so a rename of the file
 *  inside it changes nothing. */
const TEST_DIR = new Set(["__tests__", "test", "tests", "spec", "specs", "e2e", "cypress", "testsuite"]);

/** A DIRECTORY of recorded expectations. Editing one of these moves the bar without touching a
 *  single assertion, which is the quietest version of the move this guard exists to catch. */
const FIXTURE_DIR = new Set([
  "__fixtures__",
  "fixtures",
  "fixture",
  "__snapshots__",
  "snapshots",
  "__mocks__",
  "mocks",
  "testdata",
  "test-data",
  "golden",
  "goldens",
  "baselines",
]);

const FIXTURE_BASENAME = /\.snap$|(^|[.\-_])(fixture|fixtures|mock|mocks|snapshot|golden|baseline)\.[cm]?[jt]sx?$/;

/**
 * THE CONFIG THAT DECIDES WHETHER THE CHECK RUNS AND WHAT COUNTS AS PASSING. A relaxed
 * `vitest.config` exclude, a widened eslint override or a loosened `tsconfig` strictness produces a
 * green verify command over unchanged (or worse) code — indistinguishable, in the ledger, from work.
 */
const GATE_CONFIG_BASENAME =
  /^(vitest|jest|playwright|cypress|karma|ava|vite|babel|tsconfig[^/]*|jsconfig)\b.*\.(c|m)?(js|ts|json|mjs|cjs|mts|cts|yaml|yml)$|^\.?eslintrc(\..+)?$|^eslint\.config\.[cm]?[jt]s$|^tsconfig([.-][^/]+)?\.json$|^\.mocharc(\..+)?$|^(pytest\.ini|setup\.cfg|tox\.ini|pyproject\.toml|\.coveragerc|codecov\.ya?ml|sonar-project\.properties|\.pre-commit-config\.ya?ml|\.golangci\.ya?ml)$/;

/** Directories that ARE the gate: CI definitions and commit hooks. */
const GATE_DIR_PREFIX = [".github/workflows/", ".github/actions/", ".husky/", ".circleci/", ".gitlab/"];

/**
 * WHERE THE VERIFY COMMAND ITSELF IS DECLARED. `lane-verify.ts` resolves the command it runs, in
 * order, from exactly these: the `.ai` manifest, the guidance files, and `package.json` scripts —
 * plus the task runners that stand in for them outside npm. Editing any of them edits the command
 * that scores the lane, which is the most direct form of the move.
 */
const VERIFY_BASENAME =
  /^(package\.json|makefile|justfile|taskfile\.ya?ml|rakefile|cargo\.toml|go\.mod|pom\.xml|build\.gradle(\.kts)?)$|^(claude|agents|contributing)\.md$/;

function isVerifyDeclaration(p: string): boolean {
  if (VERIFY_BASENAME.test(base(p))) return true;
  // `.ai/manifest.yaml` — the repository's own machine-declared gate (lane-verify.ts step 1).
  if (segments(p)[0] === ".ai" && /manifest\.ya?ml$/.test(base(p))) return true;
  // A script the gate calls, by shape: `scripts/verify.mjs`, `scripts/check-contracts.sh`, `bin/ci.ps1`.
  const dir = segments(p)[0];
  if ((dir === "scripts" || dir === "bin" || dir === "tools") && /^(verify|check|ci|gate|lint|test)\b/.test(base(p))) return true;
  return false;
}

export function classifyScoringSurface(path: string): ScoringSurface | null {
  const p = norm(path);
  if (!p) return null;
  const segs = segments(p);
  const b = base(p);

  // Fixtures first: `__fixtures__/foo.test.json` is a recorded expectation before it is a test.
  if (segs.slice(0, -1).some((s) => FIXTURE_DIR.has(s)) || FIXTURE_BASENAME.test(b)) return "fixture";
  if (TEST_BASENAME.test(b) || segs.slice(0, -1).some((s) => TEST_DIR.has(s))) return "test-file";
  if (GATE_DIR_PREFIX.some((d) => p.startsWith(d)) || GATE_CONFIG_BASENAME.test(b)) return "gate-config";
  if (isVerifyDeclaration(p)) return "verify-command";
  return null;
}

/** What a reader is told each class means, in the one line the ledger has room for. */
const SURFACE_LABEL: Record<ScoringSurface, string> = {
  "verify-command": "the command that verifies it",
  "test-file": "a test that scores it",
  fixture: "a fixture the tests assert against",
  "gate-config": "the configuration of its own gate",
};

/** Judge one lane's committed paths. A lane with no commits is not void — it simply never rescans. */
export function checkGateDiff(changedPaths: string[]): VoidVerdict {
  const hits: { path: string; surface: ScoringSurface }[] = [];
  for (const raw of changedPaths ?? []) {
    if (typeof raw !== "string" || !raw.trim()) continue;
    const surface = classifyScoringSurface(raw);
    if (surface) hits.push({ path: raw.trim(), surface });
  }
  if (hits.length === 0) return { void: false, reason: null, paths: [] };

  const shown = hits.slice(0, MAX_REPORTED_PATHS);
  const more = hits.length - shown.length;
  // Group by class so the reason says WHAT was touched, not only which file.
  const byClass = new Map<ScoringSurface, string[]>();
  for (const h of hits) byClass.set(h.surface, [...(byClass.get(h.surface) ?? []), h.path]);
  const what = [...byClass.entries()]
    .map(([surface, paths]) => `${SURFACE_LABEL[surface]} (${surface}): ${paths.slice(0, MAX_REPORTED_PATHS).join(", ")}`)
    .join("; ");
  const reason =
    `Void — this lane's commits changed the surface that scores it: ${what}` +
    (more > 0 ? ` (+${more} more path${more === 1 ? "" : "s"})` : "") +
    ". Its lift is not credited; the lane is reported as an outcome, not dropped.";
  return { void: true, reason, paths: shown.map((h) => h.path) };
}
