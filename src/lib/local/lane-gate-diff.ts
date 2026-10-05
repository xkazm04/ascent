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
// WHAT IT VOIDS IS WEAKENING, NOT ADDING (2026-10-05). The first version voided any lane whose commits
// touched the surface at all — including files the lane CREATED. Proving the standing runner on three
// game repositories showed what that costs: on a repo that starts with no tests and no CI, the work
// that makes it AI-ready (a first test, a first workflow, a foundation install's `.ai/manifest.yaml`,
// better agent guidance) is exactly the work the guard refused to credit. So, given each path's git
// status (`GateDiffOptions`):
//   • an ADDED test file, or an ADDED file under a CI/hook directory, is cleared. A new test adds
//     assertions and a new workflow adds a gate; neither can turn an EXISTING check green — with one
//     exception: a new test file can end the RUN rather than fail a test. Go's `TestMain` owns its
//     whole package, and an `os._exit(0)` at pytest collection exits green with nothing run. So an
//     added test is cleared only once its committed text has been READ and holds no run short-circuit
//     (`RUN_SHORT_CIRCUIT` — a tripwire, not a proof). Unread is void.
//   • an ADDED fixture or gate-config basename still voids: a new fixture can change what an existing
//     snapshot loads, and a new config file can narrow what an existing check includes.
//   • the guidance declarations (`CLAUDE.md`, `AGENTS.md`, `CONTRIBUTING.md`, `.ai/manifest.yaml`) void
//     ONLY if the verify ladder resolved from them changed between the lane's base and HEAD. Their
//     prose is also the D1 work itself; what makes an edit to them a move on the instrument is a
//     changed COMMAND, and that is checkable rather than presumed. Unresolvable is void.
//   • everything else — a modification or deletion in any class, any `package.json`/build file/gate
//     script (a script BODY can change while its name stays put) — voids exactly as before. A path
//     whose status is unknown is a modification: a caller that passes bare names gets the strict guard.
//
// THREE DECLARATION MOVES ARE CLEARED ON EVIDENCE (2026-10-05, later the same day). The standing runner
// voided lanes that could not have flattered themselves (`lane-gate-diff-declare.ts` has all three):
//   • an ADDED gate script by name (`tools/guard/check.mjs`) is cleared when neither the before nor the
//     after ladder's command text references it. A script nothing runs scores nothing. Referenced, or
//     with no ladder to read, it voids; a modified or deleted one voids as before.
//   • a guidance edit that CHANGES the resolved command is cleared when the lane's own verdict was
//     reached with the OLD command, the new one is not vacuous, and the new one passes once on the
//     lane's committed tree. The lane was not measured by its own edit, and declaring the real gate is
//     the move that makes a repo AI-ready. The verdict carries the change (`gateChange`) so the call
//     site logs it for whoever merges the runner branch. A removed gate, a narrowed verdict, or a new
//     command that fails, times out or was never run still voids.
//   • a guidance edit that declares the FIRST gate (nothing resolved before) — a BOOTSTRAP — is cleared
//     when the lane's verdict was the no-check one, the new primary is not vacuous, and a rung of the
//     new ladder passes on the committed tree. No gate to a gate weakens nothing, and without this a
//     no-check repository could never acquire one through the loop. The call site upgrades `skipped`.
//     An ADDED gate script the new ladder runs is cleared with it (it IS the new gate); a modified one
//     still voids.
//

import type { ResolvedVerify } from "@/lib/local/lane-verify";
import {
  isGateScriptPath,
  judgeDeclaredGate,
  rungReferencing,
  type DeclaredGateRun,
  type GateChange,
  type LaneVerdictEvidence,
} from "@/lib/local/lane-gate-diff-declare";

export type { DeclaredGateRun, GateChange, LaneVerdictEvidence } from "@/lib/local/lane-gate-diff-declare";

/** Why a lane was voided. Printed verbatim in the ledger beside the lane. */
export interface VoidVerdict {
  void: boolean;
  /** Null when not void. */
  reason: string | null;
  /** The paths that triggered it, bounded for display. Empty when not void. */
  paths: string[];
  /** Set only on a NOT-void verdict that cleared a change of the declared gate (header): the call
   *  site logs it, so a cleared change is reviewed rather than silent. */
  gateChange?: GateChange;
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

/** Documentation inside a fixture directory — never recorded expectations. */
const FIXTURE_DOC_BASENAME = /^(readme|changelog|license)(\.(md|txt|rst))?$/;
/** A generator script's extension — a tool that MAKES fixture data rather than being it. Shell-style
 *  only: an importable module (`.py`, `.mjs`) in `__mocks__/` is auto-applied by jest to existing tests,
 *  and a `conftest.py` hooks pytest, so those stay fixtures. */
const FIXTURE_TOOL_EXT = /\.(sh|ps1|bat|cmd)$/;

const FIXTURE_BASENAME = /\.snap$|(^|[.\-_])(fixture|fixtures|mock|mocks|snapshot|golden|baseline)\.[cm]?[jt]sx?$/;

/**
 * THE CONFIG THAT DECIDES WHETHER THE CHECK RUNS AND WHAT COUNTS AS PASSING. A relaxed
 * `vitest.config` exclude, a widened eslint override or a loosened `tsconfig` strictness produces a
 * green verify command over unchanged (or worse) code — indistinguishable, in the ledger, from work.
 */
const GATE_CONFIG_BASENAME =
  /^(vitest|jest|playwright|cypress|karma|ava|vite|babel|tsconfig[^/]*|jsconfig)\b.*\.(c|m)?(js|ts|json|mjs|cjs|mts|cts|yaml|yml)$|^\.?eslintrc(\..+)?$|^eslint\.config\.[cm]?[jt]s$|^tsconfig([.-][^/]+)?\.json$|^\.mocharc(\..+)?$|^(pytest\.ini|setup\.cfg|tox\.ini|pyproject\.toml|\.coveragerc|codecov\.ya?ml|sonar-project\.properties|\.pre-commit-config\.ya?ml|\.golangci\.ya?ml)$/;

/**
 * THE SAME CLASS, IN THE SHAPES THE FLEET'S OWN TREES CARRY. Measured 2026-09-27 against the
 * gate-deciding files that exist in twelve target repositories: the list above caught 3 of 19. The
 * misses were the Rust toolchain and lint pins, commit-hook runners other than husky, secret-scan and
 * unused-code allowlists, and Python lint configs outside `pyproject.toml` — each a file whose edit
 * turns a gate green without touching a test. `conftest.py` is here wherever it sits, because a
 * root-level one is where a published benchmark's graded agent forged PASSED lines from a hook.
 * Matched on the lowercased basename, like everything else here.
 */
const GATE_CONFIG_FLEET_BASENAME =
  /^(rust-toolchain(\.toml)?|\.?clippy\.toml|\.?rustfmt\.toml|deny\.toml|nextest\.toml|\.?lefthook(-local)?\.ya?ml|\.gitleaks\.toml|\.gitleaksignore|knip\.jsonc?|\.?ruff\.toml|mypy\.ini|\.flake8|pyrightconfig\.json|conftest\.py|biome\.jsonc?|\.prettierrc(\..+)?|\.lintstagedrc(\..+)?|commitlint\.config\.[cm]?[jt]s|\.nycrc(\..+)?|\.c8rc(\..+)?|setuptests\.[cm]?[jt]sx?|(global|test)[.-]setup\.[cm]?[jt]s)$/;

/** `.cargo/config.toml` can set the flags every Rust gate compiles with (`-A warnings` included). */
const isCargoConfig = (segs: string[]): boolean =>
  segs.length >= 2 && segs.at(-2) === ".cargo" && /^config(\.toml)?$/.test(segs.at(-1) ?? "");

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
  return isGateScriptPath(p);
}

/** A gate-config file by SHAPE, wherever it sits — including inside a test directory, where the
 *  classifier below calls it a test file first. Takes a normalized path. */
const isGateConfigShape = (p: string): boolean =>
  GATE_CONFIG_BASENAME.test(base(p)) || GATE_CONFIG_FLEET_BASENAME.test(base(p)) || isCargoConfig(segments(p));

const isUnderGateDir = (p: string): boolean => GATE_DIR_PREFIX.some((d) => p.startsWith(d));

/** The verify declarations whose effect on the instrument is the resolved COMMAND and nothing else:
 *  the guidance documents and the `.ai` manifest (lane-verify.ts steps 1–2). Takes a normalized path. */
const isVerifyGuidance = (p: string): boolean =>
  /^(claude|agents|contributing)\.md$/.test(base(p)) || (segments(p)[0] === ".ai" && /manifest\.ya?ml$/.test(base(p)));

export function classifyScoringSurface(path: string): ScoringSurface | null {
  const p = norm(path);
  if (!p) return null;
  const segs = segments(p);
  const b = base(p);

  // Fixtures first: `__fixtures__/foo.test.json` is a recorded expectation before it is a test.
  // A README / CHANGELOG inside a fixture directory documents the fixtures; no test asserts against it
  // (measured 2026-10-05: a lane voided for editing `fixtures/README.md`). Everything else there is data.
  if (segs.slice(0, -1).some((s) => FIXTURE_DIR.has(s)) && FIXTURE_DOC_BASENAME.test(b)) return null;
  if (segs.slice(0, -1).some((s) => FIXTURE_DIR.has(s)) || FIXTURE_BASENAME.test(b)) return "fixture";
  if (TEST_BASENAME.test(b) || segs.slice(0, -1).some((s) => TEST_DIR.has(s))) return "test-file";
  if (isUnderGateDir(p) || isGateConfigShape(p)) return "gate-config";
  if (isVerifyDeclaration(p)) return "verify-command";
  return null;
}

/** Does this path's change call for the verify-ladder comparison? The loader asks before resolving. */
export function needsVerifyLadder(path: string): boolean {
  const p = norm(path);
  return classifyScoringSurface(p) === "verify-command" && isVerifyGuidance(p);
}

/** A gate script by name (`tools/guard/check.mjs`) — if ADDED, cleared only against the verify
 *  ladder, so the loader resolves one for it too. Takes a raw or normalized path. */
export function isAddedGateScriptCandidate(path: string): boolean {
  const p = norm(path);
  return classifyScoringSurface(p) === "verify-command" && isGateScriptPath(p);
}

/** A test file that may be cleared when ADDED: not one that is a gate config or a verify declaration
 *  by shape (`tests/conftest.py`, `e2e/playwright.config.ts`), which a test directory would otherwise
 *  let through as "a test". Takes a normalized path. */
const isClearableTest = (p: string): boolean =>
  classifyScoringSurface(p) === "test-file" && !isGateConfigShape(p) && (!isVerifyDeclaration(p) || EXPLICIT_TEST_INFIX.test(base(p)));

/** `name.test.mjs` / `name-test.cjs` / `name_spec.ts`: a test BY ITS OWN DECLARATION, even under a gate-script-shaped path
 *  (`tools/check-action-pins.test.mjs`, the test for a new check script, measured 2026-10-05). A bare
 *  `scripts/test.mjs` has no infix and may BE the verify script, so it stays excluded. */
const EXPLICIT_TEST_INFIX = /[.\-_](test|spec)\.[cm]?[jt]sx?$/;

/** Does this path, if ADDED, need its committed text read before it can be cleared? */
export function needsAddedText(path: string): boolean {
  return isClearableTest(norm(path));
}

/** What a reader is told each class means, in the one line the ledger has room for. */
const SURFACE_LABEL: Record<ScoringSurface, string> = {
  "verify-command": "the command that verifies it",
  "test-file": "a test that scores it",
  fixture: "a fixture the tests assert against",
  "gate-config": "the configuration of its own gate",
};

/** One changed path with git's `--name-status` letter (A added, M modified, D deleted, T type…). */
export interface PathChange {
  path: string;
  status: string;
}

/** One rung of the resolved verify ladder — the part of it that IS the instrument. */
export type LadderRung = Pick<ResolvedVerify, "command" | "rung">;

/**
 * The evidence that lets the guard tell ADDING from WEAKENING. Every field is optional and every
 * absence is strict: no status reads as a modification, no text leaves an added test unread, no
 * ladder leaves a guidance edit void. A caller that cannot gather evidence gets the old guard.
 */
export interface GateDiffOptions {
  /** git's status letter per path, keyed exactly as the path is passed. */
  statuses?: Readonly<Record<string, string>>;
  /** The committed text of ADDED test files, keyed exactly as the path is passed. Null = unread. */
  addedText?: Readonly<Record<string, string | null>>;
  /** The verify ladder resolved at the lane's base and at its HEAD. Missing = could not resolve. */
  verifyLadder?: { before: readonly LadderRung[]; after: readonly LadderRung[] } | null;
  /** The lane's own guard verdict and the command it ran. Missing = a changed gate cannot be cleared. */
  laneVerdict?: LaneVerdictEvidence | null;
  /** The NEW ladder's rungs as run on the lane's tree (primary only for a change; in order to the first pass for a
   *  bootstrap). Missing = a changed or first gate cannot be cleared. */
  declaredGateRuns?: readonly DeclaredGateRun[] | null;
}

/**
 * A TEST FILE THAT CAN END THE RUN instead of failing a test in it: Go's `TestMain` (it owns its whole
 * package's run) and the process exits each ecosystem offers. Matched on an added test file's committed
 * text. A tripwire, not a proof, and it errs strict: a CLI test that legitimately asserts on
 * `sys.exit(` voids too, and the human reads the commits the void leaves on the branch.
 */
const RUN_SHORT_CIRCUIT =
  /\bfunc\s+TestMain\s*\(|\bos\.(?:_exit|exit|Exit)\s*\(|\bsys\.exit\s*\(|\bpytest\.exit\s*\(|\bprocess\.(?:exit|reallyExit|abort)\s*\(|\bprocess\.kill\s*\(\s*process\.pid|\bSystem\.exit\s*\(|\bRuntime\.getRuntime\(\)\s*\.\s*(?:halt|exit)\s*\(|\bEnvironment\.(?:Exit|FailFast)\s*\(|\bprocess::exit\s*\(|\bKernel\.exit|\bexit!/;

const ladderKey = (l: readonly LadderRung[]): string => JSON.stringify(l.map((r) => [r.rung, r.command]));
const ladderText = (l: readonly LadderRung[]): string =>
  l.length === 0 ? "(none resolved)" : l.map((r) => `\`${r.command}\``).join(" | ");

/** A changed declared gate, judged once per verdict: cleared with its change, or refused with why. */
type DeclaredJudgement = ReturnType<typeof judgeDeclaredGate> | null;

/** HOW a path touched its class, for the reason — or null when the touch is cleared (header). */
/** The runners that can read a gate config, by family, matched as whole tokens in a rung's command. */
const CONFIG_READERS: readonly { config: RegExp; runners: RegExp }[] = [
  {
    config: /^(\.?eslintrc|eslint\.config|tsconfig|jsconfig|vitest|jest|playwright|cypress|karma|ava|vite|babel|biome|\.?prettierrc|\.lintstagedrc|commitlint|knip|\.nycrc|\.c8rc|\.mocharc)/,
    runners: /(^|[\s;&|(])(npm|npx|pnpm|yarn|bun|node|deno|tsc|eslint|vitest|jest|playwright|prettier|biome)(\b|$)/,
  },
  {
    config: /^(\.?ruff\.toml|mypy\.ini|\.flake8|pytest\.ini|setup\.cfg|tox\.ini|pyproject\.toml|\.coveragerc|pyrightconfig\.json|conftest\.py)$/,
    runners: /(^|[\s;&|(])(python3?|py|pytest|ruff|mypy|flake8|tox|nox|uv|poetry|pip|pyright|coverage)(\b|$)/,
  },
  { config: /^(rust-toolchain(\.toml)?|\.?clippy\.toml|\.?rustfmt\.toml|deny\.toml|nextest\.toml)$/, runners: /(^|[\s;&|(])(cargo|rustc|rustup)(\b|$)/ },
  { config: /^\.golangci\.ya?ml$/, runners: /(^|[\s;&|(])(go|golangci-lint)(\b|$)/ },
];

/** True only when the config belongs to a known family AND no rung of any ladder runs a reader of it. */
function configUnreachable(p: string, ladders: readonly (readonly { command: string }[])[]): boolean {
  const family = CONFIG_READERS.find((f) => f.config.test(base(p)));
  if (!family) return false;
  return ladders.every((ladder) => ladder.every((r) => !family.runners.test(r.command.toLowerCase())));
}

function judgeChange(
  p: string,
  surface: ScoringSurface,
  status: string | null,
  text: string | null,
  opts: GateDiffOptions,
  declared: DeclaredJudgement,
): string | null {
  const s = (status ?? "").trim().charAt(0).toUpperCase();
  const how = s === "A" ? "added" : s === "D" ? "deleted" : s ? "modified" : "changed";

  if (surface === "verify-command" && isVerifyGuidance(p)) {
    const ladder = opts.verifyLadder;
    if (!ladder) return `${how}; its resolved verify command could not be compared`;
    if (ladderKey(ladder.before) === ladderKey(ladder.after)) return null;
    if (declared && "change" in declared) return null;
    const why = declared && "refused" in declared ? `; not cleared: ${declared.refused}` : "";
    return `${how}, changing the verify command ${ladderText(ladder.before)} -> ${ladderText(ladder.after)}${why}`;
  }
  // A MODIFIED or DELETED gate script that NO rung of either ladder runs is cleared too: the guard's
  // verdict comes from the ladder alone, so editing a script nothing in it runs cannot flatter it.
  // Measured 2026-10-05: the second lane to refine a pre-commit guard the first lane had added
  // (`tools/guard/check.mjs`, gate `dotnet test …`) was voided for "modifying" it. Missing ladder
  // evidence, or a ladder that runs the script, still voids — that is the weakening this guard is for.
  if (s !== "A" && surface === "verify-command" && isGateScriptPath(p)) {
    const ladder = opts.verifyLadder;
    if (!ladder) return `${how}; the verify command could not be read, so it cannot be cleared`;
    const runBy = rungReferencing(p, [ladder.before, ladder.after]);
    return runBy ? `${how}, and the verify command \`${runBy}\` runs it` : null;
  }
  if (s !== "A") return how;
  // An ADDED gate script is cleared when no rung of either ladder runs it (header) — or when a cleared
  // BOOTSTRAP runs it: with no prior gate there was nothing for it to flatter, and the script IS the
  // new gate, which has just passed on this tree. A modified or deleted one never reaches here.
  if (surface === "verify-command" && isGateScriptPath(p)) {
    const ladder = opts.verifyLadder;
    if (!ladder) return "added; the verify command could not be read, so it cannot be cleared";
    const runBy = rungReferencing(p, [ladder.before, ladder.after]);
    if (runBy && declared && "change" in declared && declared.change.measured === "bootstrap") return null;
    return runBy ? `added, and the verify command \`${runBy}\` runs it` : null;
  }
  if (surface === "gate-config" && isUnderGateDir(p)) return null;
  // An ADDED gate config no rung can read: a repository whose gate is `dotnet test` gains its first ESLint
  // or Ruff config for its tooling scripts (measured 2026-10-05) — exactly the linter a D6 gap asks
  // for — and no rung of either ladder runs a toolchain that reads it, so it cannot narrow the check.
  // Missing ladder evidence, or a rung whose toolchain could read it, still voids.
  if (surface === "gate-config" && opts.verifyLadder && configUnreachable(p, [opts.verifyLadder.before, opts.verifyLadder.after])) return null;
  // An ADDED generator SCRIPT in a fixture directory (`fixtures/make-clip.sh`) is a tool that makes data,
  // not data a test asserts against; an added data file there still voids (an existing test may glob it).
  if (surface === "fixture" && FIXTURE_TOOL_EXT.test(p) && !segments(p).some((x) => x === "__mocks__" || x === "mocks")) return null;
  if (isClearableTest(p)) {
    if (text == null) return "added; its text was not read, so it cannot be cleared";
    return RUN_SHORT_CIRCUIT.test(text) ? "added, and it can end the test run early" : null;
  }
  return how;
}

/**
 * Judge one lane's committed paths. A lane with no commits is not void — it simply never rescans.
 * Bare strings are the strict guard (status unknown = modified); a `PathChange` or `opts.statuses`
 * lets an ADDED path be judged as one, and `opts.verifyLadder` lets a guidance edit be (header).
 */
export function checkGateDiff(changedPaths: ReadonlyArray<string | PathChange>, opts: GateDiffOptions = {}): VoidVerdict {
  const hits: { path: string; surface: ScoringSurface; how: string }[] = [];
  const ladder = opts.verifyLadder;
  const declared: DeclaredJudgement =
    ladder && ladderKey(ladder.before) !== ladderKey(ladder.after) ? judgeDeclaredGate(ladder, opts.laneVerdict, opts.declaredGateRuns) : null;
  /** The guidance paths a cleared gate change was declared in — named in `gateChange.files`. */
  const declaredIn: string[] = [];
  // A path git gave a STATUS for is judged even when the name list missed it: a name list read with
  // rename detection on carries only a moved file's destination, and the deletion is what voids.
  const entries: (string | PathChange)[] = [...(changedPaths ?? [])];
  const seen = new Set(entries.map((e) => norm(typeof e === "string" ? e : String(e?.path ?? ""))));
  for (const p of Object.keys(opts.statuses ?? {})) if (!seen.has(norm(p))) entries.push(p);
  for (const entry of entries) {
    const raw = typeof entry === "string" ? entry : entry && typeof entry === "object" ? entry.path : null;
    if (typeof raw !== "string" || !raw.trim()) continue;
    const path = raw.trim();
    const surface = classifyScoringSurface(path);
    if (!surface) continue;
    const status = typeof entry === "object" ? entry.status : (opts.statuses?.[raw] ?? opts.statuses?.[path] ?? null);
    const text = opts.addedText?.[raw] ?? opts.addedText?.[path] ?? null;
    const how = judgeChange(norm(path), surface, status, text, opts, declared);
    if (how) hits.push({ path, surface, how });
    else if (declared && "change" in declared && surface === "verify-command" && isVerifyGuidance(norm(path))) declaredIn.push(path);
  }
  if (hits.length === 0) {
    const cleared = { void: false, reason: null, paths: [] };
    return declared && "change" in declared && declaredIn.length > 0
      ? { ...cleared, gateChange: { ...declared.change, files: declaredIn } }
      : cleared;
  }

  const shown = hits.slice(0, MAX_REPORTED_PATHS);
  const more = hits.length - shown.length;
  // Group by class AND by how it was touched, so the reason says WHAT was done, not only which file.
  const groups = new Map<string, { surface: ScoringSurface; how: string; paths: string[] }>();
  for (const h of hits) {
    const key = `${h.surface}|${h.how}`;
    const g = groups.get(key) ?? { surface: h.surface, how: h.how, paths: [] };
    g.paths.push(h.path);
    groups.set(key, g);
  }
  const what = [...groups.values()]
    .map((g) => `${SURFACE_LABEL[g.surface]} (${g.surface}, ${g.how}): ${g.paths.slice(0, MAX_REPORTED_PATHS).join(", ")}`)
    .join("; ");
  const reason =
    `Void — this lane's commits changed the surface that scores it: ${what}` +
    (more > 0 ? ` (+${more} more path${more === 1 ? "" : "s"})` : "") +
    ". Its lift is not credited; the lane is reported as an outcome, not dropped.";
  return { void: true, reason, paths: shown.map((h) => h.path) };
}

/**
 * Parse `git diff --name-status --no-renames -z` into a status per path. ALL OR NOTHING: a stream that
 * does not parse cleanly returns an empty map, because a half-trusted parse could read a modified file
 * as added — and an empty map is simply the strict guard.
 */
export function parseNameStatus(stdout: string): Record<string, string> {
  const tok = stdout.split("\0");
  if (tok.at(-1) === "") tok.pop();
  const out: Record<string, string> = {};
  for (let i = 0; i < tok.length; ) {
    const status = tok[i] ?? "";
    if (!/^[ACDMRTUXB]\d*$/.test(status)) return {};
    // A rename/copy (only if renames were left on) carries two paths. Neither side is trusted as an
    // add: both get the strict letter, so a moved test still voids.
    const width = status[0] === "R" || status[0] === "C" ? 2 : 1;
    const paths = tok.slice(i + 1, i + 1 + width);
    if (paths.length !== width || paths.some((p) => !p)) return {};
    for (const p of paths) out[p] = width === 2 ? "M" : status;
    i += 1 + width;
  }
  return out;
}
