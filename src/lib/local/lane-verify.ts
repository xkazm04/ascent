// THE A/B DEGRADATION GUARD, pure half: WHICH command proves this repository still works.
//
// (The four VERDICTS live next door in the dependency-free `verify-options.ts` and are re-exported
// below — this module's readers pull the analyzer graph in behind them, and the cockpit needs the
// verdict's word without any of that.)
//
// THE PROBLEM IT SOLVES IS NOT "the agent breaks things". It is that the agent, knowing nothing would
// catch it if it did, makes small safe changes. A 21-run campaign on two real repositories produced
// 34 commits and moved one repo's overall score DOWN a point: item-shaped edits, no restructuring, no
// de-duplication, no performance work. The brief now explicitly invites structural change
// (`buildFixPrompt`) — and an invitation to take a larger swing is only honest if something catches
// the swing that misses. That something is this: run the repository's own checks before the session
// and again after it, and if a pass became a failure, throw the work away in the worktree it already
// lives in and say so.
//
// NOTHING HERE IS INVENTED. The command is RESOLVED from what the repository already declares, in a
// fixed order, and every step reuses an existing reader:
//
//   1. `.ai/manifest.yaml` — `readManifestYaml` (src/lib/standard/read.ts). A capability wired at
//      `controls.ciHardPass` IS the repository's own statement of its gate; `prePush` is the same
//      statement one step earlier. This is the most authoritative source because it is the only one
//      that is machine-declared rather than inferred from prose.
//   2. A CI-SHAPED COMMAND, wherever it is declared — `check:ci`, `ci`, `verify`, `check` — read from
//      the guidance files first and then `package.json`. THE REASON IS THE WORKTREE. The guard runs on
//      a fresh `git worktree`: tracked files plus the dependency caches the loop links, and no
//      gitignored local state. A command CI runs is by construction a command that works from a clean
//      checkout, which is exactly the situation the guard is in; a repository's bare `test` script
//      very often is not, because the operator's own checkout carries credentials, `.env` files and
//      service config the worktree correctly does not. Preferring `test` is how
//      `xkazm04/systedo-case` landed on `npm run test:unit` — 3744/3744 green in the paired checkout,
//      8 failing in a worktree cut from the same commit, every one of them a missing Google
//      application-default credential.
//   3. The guidance files BY CAPABILITY — `parseCommands` (src/lib/analyze/guidance-graph.ts), the
//      SAME extraction the scorer's `commands_agree` facet runs over CLAUDE.md / AGENTS.md /
//      CONTRIBUTING.md. If the repo tells its agents "run `npm run test:unit`", that is the command it
//      means — accepted here even though it may need state a clean checkout does not have.
//   4. `package.json` scripts — the conventional names, last, because a script that exists is weaker
//      evidence than a command the repository asked for in words.
//   5. Nothing resolvable → the guard is SKIPPED, and it says so on the lane. Never a silent pass:
//      "we could not check" and "we checked and it was fine" are different facts and a ledger that
//      renders them the same way is lying.
//
// A RESOLVED COMMAND IS REPO-AUTHORED CODE AND RUNNING IT EXECUTES IT. That is already true of this
// loop — it spawns an editing agent inside the checkout — and the same gates apply: self-hosted
// deployments only, owner-only to arm, and a per-run switch (`verifyMode: "off"`) that turns the
// whole thing off. Commands the manifest reader REDACTED (a secret-shaped run) and commands carrying
// a `<placeholder>` are refused here rather than executed, because neither is a command anybody
// actually declared.
//
// This module is PURE: strings in, a resolution out. The spawning, the baseline cache and the discard
// live in `lane-guard.ts`, so the resolution order can be table-tested without a subprocess.

import { readManifestYaml } from "@/lib/standard/read";
import { parseCommands } from "@/lib/analyze/guidance-graph";

// THE VERDICT VOCABULARY lives in the dependency-free `verify-options.ts` and is re-exported here, so
// a server caller has one import while the cockpit's lane rail can take the word alone without
// dragging this module's readers (and the analyzer graph behind them) into a browser bundle.
export {
  VERIFY_RUNGS,
  VERIFY_VERDICTS,
  asVerifyRung,
  asVerifyVerdict,
  isNarrowedRung,
  narrowedRungTag,
  verifyVerdictTag,
  type VerifyRung,
  type VerifyVerdict,
} from "@/lib/local/verify-options";

import type { VerifyRung } from "@/lib/local/verify-options";

/** A command the guard will run, and where the repository declared it. */
export interface ResolvedVerify {
  command: string;
  /** Human-readable provenance, printed on the lane: "`.ai/manifest.yaml` (ciHardPass)". */
  source: string;
  /** WHICH RUNG OF THE NARROWING LADDER this is. `primary` is the repository's own declared gate;
   *  `typecheck` and `lint` are strictly weaker hermetic fallbacks, and every surface that renders a
   *  verdict reached on one has to say so. */
  rung: VerifyRung;
}

/** The files the resolution reads, as text. All optional — a repository declaring none resolves to
 *  `null`, which is the SKIPPED verdict rather than a fallback command invented on its behalf. */
export interface VerifyInputs {
  manifestYaml?: string | null;
  /** Guidance documents in PRECEDENCE ORDER (CLAUDE.md, AGENTS.md, CONTRIBUTING.md). */
  guidance?: readonly { path: string; text: string }[];
  packageJson?: string | null;
  /** Does the worktree carry a `tsconfig.json`? The ONE piece of evidence that licenses the ladder's
   *  only invented command, `npx tsc --noEmit` — see `TSC_NOEMIT`. Absent/false and the typecheck rung
   *  needs a declared script, exactly like every other rung. */
  hasTsconfig?: boolean;
}

/** A command must not be run when the manifest reader redacted a secret out of it, or when it still
 *  carries a `<placeholder>`: neither is a command the repository actually declared. */
const RUNNABLE = (c: string): boolean => c.trim().length > 0 && !c.includes("«redacted»") && !/<[^>]+>/.test(c);

/** At most three declared capabilities are chained. The manifest may wire a dozen; three is already
 *  the whole of a typical hard pass (typecheck, lint, test) and the guard has a ten-minute budget. */
const MAX_CHAINED = 3;

/**
 * The keys `parseCommands` produces, in the order the guard prefers them — consulted only AFTER the
 * CI-shaped pass below has found nothing.
 *
 * `test` first because a behavioural regression is the failure a bold refactor actually risks;
 * `typecheck` next because it is the cheapest structural proof; `build` before `lint` because a
 * broken build is unambiguous while a lint rule can be a style opinion. Nothing else is used: `dev`
 * would start a server that never exits, `install` proves nothing about the change, and `format`
 * rewrites files rather than judging them.
 */
const GUIDANCE_KEY_ORDER: readonly string[] = ["test", "typecheck", "build", "lint"];

/**
 * `package.json` script names, in the order a repository means them as "the gate".
 *
 * The composite names come first on purpose: a repo with both `check:ci` and `test` means the former
 * when it says "the checks", and running only its unit tests would be a weaker guard than the one it
 * already wrote for itself. Every CI-shaped name here is also matched a layer EARLIER
 * (`CI_TARGET_ORDER`), where it can outrank a bare `test` quoted in a guidance file; the list is kept
 * whole so a name cannot silently drop out of one place while surviving in the other.
 */
const SCRIPT_ORDER: readonly string[] = ["check:ci", "ci", "verify", "check", "test:ci", "test"];

/**
 * SCRIPT/TARGET NAMES A REPOSITORY USES FOR "WHAT CI RUNS", best first.
 *
 * Why they are preferred over anything else the repository declares: CI starts from a clean checkout
 * with none of the operator's secrets, and so does the lane's worktree. A command that is green in CI
 * is a command that CAN establish a baseline here. A bare `test` script often cannot — not because
 * the repository is broken, but because the suite reaches for a `.env`, a service account or a local
 * database that a worktree correctly does not carry. `check` is the weakest of these (a composite
 * gate by convention, not necessarily the one CI runs) and is still ahead of `test`.
 */
const CI_TARGET_ORDER: readonly string[] = [
  "check:ci",
  "ci:check",
  "ci",
  "verify:ci",
  "verify",
  "test:ci",
  "check:all",
  "gate",
  "gates",
  "check",
];

/** The rank of a command's TARGET within `CI_TARGET_ORDER`, or -1. The target is the command's last
 *  token, which is the script name for every runner shape `parseCommands` produces (`npm run
 *  check:ci`, `make ci`, `pnpm verify`) and harmlessly not a match for the rest (`pytest -q`). */
function ciRank(command: string): number {
  const target = (command.trim().split(/\s+/).pop() ?? "").toLowerCase();
  return CI_TARGET_ORDER.indexOf(target);
}

/** Is this the command the repository's CI runs, by the name the repository gave it? Exported so a
 *  test — and anything explaining a resolution to an operator — uses the same rule the resolver does. */
export const isCiShapedCommand = (command: string): boolean => ciRank(command) >= 0;

/** A resolution without its rung — every source produces one of these, and the rung is stamped by
 *  whichever pass asked for it. Keeps the narrowed passes from having to repeat the literal. */
type Unranked = Omit<ResolvedVerify, "rung">;
const at = (rung: VerifyRung, r: Unranked | null): ResolvedVerify | null => (r ? { ...r, rung } : null);

function fromManifest(yaml: string | null | undefined): Unranked | null {
  if (!yaml || !yaml.trim()) return null;
  const readout = readManifestYaml(yaml);
  if (readout.status !== "ok" && readout.capabilities.length === 0) return null;
  for (const placement of ["ciHardPass", "prePush"] as const) {
    const wired = readout.capabilities.filter((c) => c.wiredAt.includes(placement) && !c.placeholder && RUNNABLE(c.command));
    if (wired.length === 0) continue;
    const commands = [...new Set(wired.map((c) => c.command.trim()))].slice(0, MAX_CHAINED);
    return { command: commands.join(" && "), source: `.ai/manifest.yaml (${placement})` };
  }
  return null;
}

/** The first command in ONE guidance document whose key is in `keys`, in `keys` order. Shared by the
 *  primary pass (which asks for all four keys, document-major) and the narrowing ladder (which asks
 *  for exactly one), so both read guidance through the same extraction. */
function guidanceHit(doc: { path: string; text: string }, keys: readonly string[]): Unranked | null {
  if (!doc.text || !doc.text.trim()) return null;
  const found = parseCommands(doc.text);
  for (const key of keys) {
    const hit = found.find((c) => c.key === key && RUNNABLE(c.command));
    if (hit) return { command: hit.command.trim(), source: `${doc.path} (${key})` };
  }
  return null;
}

function fromGuidance(docs: readonly { path: string; text: string }[] | undefined): Unranked | null {
  for (const doc of docs ?? []) {
    const hit = guidanceHit(doc, GUIDANCE_KEY_ORDER);
    if (hit) return hit;
  }
  return null;
}

/** `package.json`'s `scripts` object, or `null`. An unparseable file falls through rather than
 *  throwing: a broken declaration is not evidence that no check exists. */
function readScripts(raw: string | null | undefined): Record<string, unknown> | null {
  if (!raw || !raw.trim()) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    const s = (parsed as { scripts?: unknown } | null)?.scripts;
    if (!s || typeof s !== "object" || Array.isArray(s)) return null;
    return s as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** The first of `names` that `package.json` declares as a non-empty script. Shared by the primary
 *  pass and the narrowing ladder for the same reason `guidanceHit` is: one scanner, one answer. */
function scriptsNamed(raw: string | null | undefined, names: readonly string[]): Unranked | null {
  const scripts = readScripts(raw);
  if (!scripts) return null;
  for (const name of names) {
    const body = scripts[name];
    if (typeof body !== "string" || body.trim() === "") continue;
    // `npm test` is the real invocation for the `test` script; every other name needs `run`.
    const command = name === "test" ? "npm test" : `npm run ${name}`;
    return { command, source: `package.json (scripts.${name})` };
  }
  return null;
}

const fromPackageJson = (raw: string | null | undefined): Unranked | null => scriptsNamed(raw, SCRIPT_ORDER);

/**
 * THE CI-SHAPED PASS — the best-named CI command anywhere below the manifest.
 *
 * Deliberately NOT layered by source. A `check:ci` script in `package.json` beats a bare `test`
 * quoted in AGENTS.md, because the question this pass answers is not "what does the repository tell
 * its agents to run" but "what runs from a clean checkout", and the script's NAME is the only
 * evidence either file carries about that. Rank decides; declaration order (guidance in precedence
 * order, then `package.json`) only breaks ties, so a document still outranks a script at equal rank.
 */
function fromCiShaped(inputs: VerifyInputs): Unranked | null {
  const candidates: Unranked[] = [];
  for (const doc of inputs.guidance ?? []) {
    if (!doc.text || !doc.text.trim()) continue;
    for (const c of parseCommands(doc.text)) {
      const command = c.command.trim();
      if (RUNNABLE(command) && isCiShapedCommand(command)) candidates.push({ command, source: `${doc.path} (ci)` });
    }
  }
  const scripts = readScripts(inputs.packageJson);
  if (scripts) {
    for (const name of CI_TARGET_ORDER) {
      const body = scripts[name];
      if (typeof body === "string" && body.trim() !== "") candidates.push({ command: `npm run ${name}`, source: `package.json (scripts.${name})` });
    }
  }
  let best: Unranked | null = null;
  let bestRank = Number.MAX_SAFE_INTEGER;
  for (const candidate of candidates) {
    const rank = ciRank(candidate.command);
    if (rank >= 0 && rank < bestRank) {
      best = candidate;
      bestRank = rank;
    }
  }
  return best;
}

/**
 * The repository's own verification command, or `null` when it declares none.
 *
 * Deterministic and total: same inputs, same answer, never a throw. A malformed manifest or an
 * unparseable `package.json` falls through to the next source rather than failing the resolution —
 * the guard's job is to find a check, and a broken declaration is not evidence that no check exists.
 */
export function resolveVerifyCommand(inputs: VerifyInputs): ResolvedVerify | null {
  return at(
    "primary",
    fromManifest(inputs.manifestYaml) ??
      fromCiShaped(inputs) ??
      fromGuidance(inputs.guidance) ??
      fromPackageJson(inputs.packageJson),
  );
}

// ── THE NARROWING LADDER — the strongest check that CAN run in a worktree ─────────────────────
//
// WHY IT EXISTS. The guard's premise was that the repository's own command can establish a baseline
// on a pristine lane worktree. Measured on both campaign repositories at the same commit, with
// `node_modules` linked exactly as the lane links it, that premise does not hold:
// `xkazm04/systedo-case` passes 3744/3744 in the paired checkout and fails 8 in the worktree, every
// failure `Could not load the default credentials`; `xkazm04/kp` passes in the checkout and fails 2
// routes that need local state; systedo's `npm run check` dies in a worktree on a
// `TurbopackInternalError` in its build step. A worktree carries tracked files plus the dependency
// caches the loop links and NONE of the gitignored credentials, service config or local databases a
// realistic suite needs — so the guard protected nothing on exactly the repositories it was built
// for, and (because unverified work must not be delivered) it also blocked all delivery.
//
// A WEAKER GUARD IS STILL A GUARD. Typechecking and linting are HERMETIC: they need no credentials
// and no services, so they can establish a baseline where the suite cannot. And a structural refactor
// that breaks the build or the types is the damage most worth catching — which is precisely the
// change `STRUCTURAL_INVITATION` now asks agents to attempt.
//
// NOTHING IS INVENTED HERE EITHER, with ONE documented exception. Each rung is resolved from the same
// three sources the primary uses — the manifest's own capability names, the guidance files through
// `parseCommands`' keys, and `package.json` scripts — through the same helpers (`guidanceHit`,
// `scriptsNamed`). The exception is `npx tsc --noEmit` for a repository that has a `tsconfig.json`
// and no typecheck script: a TypeScript project's typecheck command is not a vendor guess, it is what
// the tsconfig means, and refusing to run it would leave the most common case in the fleet unguarded.
//
// THE LADDER ONLY EXISTS WHEN A PRIMARY DID. A repository that declares no check at all still gets
// `skipped`, unchanged: narrowing is a DEGRADATION of a gate the repository asked for, not a gate
// invented for a repository that asked for none.

/** `package.json` script / manifest capability names for a typecheck, best first. `tsc` is included
 *  because a repo that names its script after the binary means the binary. */
const TYPECHECK_NAMES: readonly string[] = ["typecheck", "type-check", "types", "tsc"];

/** …and for a lint. `lint:ci` sits with them for the same reason `check:ci` outranks `check` above:
 *  a name with `ci` in it is a name the repository chose for a clean checkout. */
const LINT_NAMES: readonly string[] = ["lint", "lint:check", "lint:ci"];

const NARROWED_NAMES: Readonly<Record<Exclude<VerifyRung, "primary">, readonly string[]>> = {
  typecheck: TYPECHECK_NAMES,
  lint: LINT_NAMES,
};

/** THE ONE COMMAND THE LADDER WILL SYNTHESIZE, and only for a repository that carries a
 *  `tsconfig.json` and declares no typecheck script of its own. */
export const TSC_NOEMIT = "npx tsc --noEmit";

/** A manifest capability by NAME — the most authoritative source for a narrowed rung too, and the
 *  only one that is machine-declared. Placement is not required: a repository that declares a
 *  `typecheck` capability has told us its typecheck command whether or not it wired it at a gate. */
function fromManifestNamed(yaml: string | null | undefined, names: readonly string[]): Unranked | null {
  if (!yaml || !yaml.trim()) return null;
  const readout = readManifestYaml(yaml);
  if (readout.status !== "ok" && readout.capabilities.length === 0) return null;
  for (const name of names) {
    const hit = readout.capabilities.find((c) => c.name.toLowerCase() === name && !c.placeholder && RUNNABLE(c.command));
    if (hit) return { command: hit.command.trim(), source: `.ai/manifest.yaml (${hit.name})` };
  }
  return null;
}

/** One narrowed rung, or `null` when this repository declares nothing of that shape. */
function narrowedRung(inputs: VerifyInputs, rung: Exclude<VerifyRung, "primary">): ResolvedVerify | null {
  const names = NARROWED_NAMES[rung];
  const found =
    fromManifestNamed(inputs.manifestYaml, names) ??
    (inputs.guidance ?? []).reduce<Unranked | null>((acc, doc) => acc ?? guidanceHit(doc, [rung]), null) ??
    scriptsNamed(inputs.packageJson, names) ??
    (rung === "typecheck" && inputs.hasTsconfig ? { command: TSC_NOEMIT, source: "tsconfig.json (no typecheck script)" } : null);
  return at(rung, found);
}

/**
 * THE LADDER, best first: the primary, then a typecheck, then a lint.
 *
 * The caller runs them IN ORDER on the pristine worktree and takes the FIRST that passes as the
 * baseline (`verifyBaseline`). Empty when the repository declares no primary command — narrowing
 * degrades a declared gate and never substitutes for one.
 *
 * Deduplicated by command: when the repository's primary IS its typecheck, the ladder is one rung
 * long and a failing primary is not re-run under a second name to fail identically.
 */
export function resolveVerifyLadder(inputs: VerifyInputs): ResolvedVerify[] {
  const primary = resolveVerifyCommand(inputs);
  if (!primary) return [];
  const out: ResolvedVerify[] = [];
  const seen = new Set<string>();
  for (const r of [primary, narrowedRung(inputs, "typecheck"), narrowedRung(inputs, "lint")]) {
    if (!r || seen.has(r.command)) continue;
    seen.add(r.command);
    out.push(r);
  }
  return out;
}

/**
 * THE SENTENCE EVERY NARROWED SURFACE OWES ITS READER — one clause, shared, so the note, the lane
 * log, the sheet's hover text and the brief cannot drift into saying different things.
 *
 * It names what WAS checked, names what was NOT, and says why. Never "verified" on its own: a lane
 * verified against `npm run typecheck` has not been verified against the repository's tests, and the
 * whole cost of getting this wrong is a reader who believes it was.
 */
export const narrowedCaveat = (narrowed: ResolvedVerify, primary: ResolvedVerify): string =>
  `verified against \`${narrowed.command}\` ONLY (${narrowed.rung}, from ${narrowed.source}): the command this repository ` +
  `declares — \`${primary.command}\` (from ${primary.source}) — could not establish a baseline in this worktree, so the ` +
  `tests were NOT run and nothing here is verified against them`;

/** The paths the guard reads, in the order `resolveVerifyCommand` consults them. Exported so the
 *  reader in `lane-guard.ts` cannot drift from the resolver that consumes what it read. */
export const VERIFY_MANIFEST_PATH = ".ai/manifest.yaml";
export const VERIFY_GUIDANCE_PATHS: readonly string[] = ["CLAUDE.md", "AGENTS.md", "CONTRIBUTING.md"];
export const VERIFY_PACKAGE_PATH = "package.json";
/** Not a source of commands — the single piece of evidence that licenses `TSC_NOEMIT`. */
export const VERIFY_TSCONFIG_PATH = "tsconfig.json";

// THE RUNNER'S OWN FAILURE MARKERS — not "any line that contains the word error".
//
// WHAT THE LOOSE MATCH ACTUALLY CAPTURED. On `xkazm04/systedo-case` the persisted "First failure"
// read as three lines of console noise printed by PASSING tests — `[activity] list failed … fake
// firestore: unavailable`, each followed by a ✔ — because the old rule filtered the WHOLE log from
// the HEAD for anything containing "fail" or "error". Application logging says those words constantly
// and says them early; a test runner states its verdict at the END. An excerpt that shows a passing
// test's log line instead of the failing assertion is worse than no excerpt: it sends the reader (and
// the next agent) after the wrong thing entirely.
//
// So this matches only the shapes a RUNNER prints when it is reporting a failure — node:test's `✖`,
// TAP's `not ok`, vitest/jest's `FAIL` and `Failed Tests`, mocha's `N failing`, node:test's `# fail`,
// an `AssertionError`, `tsc`'s `error TS####` — and when it finds none it reads the TAIL.
const FAILURE_MARKER_RE =
  /(?:^|\s)(?:✖|✕|×|✗|not ok\b|FAIL\b|FAILED\b|Failed Tests\b|failing tests\b|# fail\b|\d+ failing\b|AssertionError\b|error TS\d+)/;

/**
 * The MEANINGFUL failure lines of a command's output — what the lane records so the operator can see
 * WHY the guard could not clear this cycle without opening a worktree that no longer exists.
 *
 * From the runner's failure section when there is one: the excerpt starts at the FIRST marker line
 * and runs forward, because a failing assertion's detail follows its marker rather than preceding it.
 * With no marker anywhere, the TAIL — a command that failed with unrecognisable output still said
 * something last, and an empty note would be indistinguishable from "we did not look". Bounded hard:
 * this ends up in a database column and on a lane row.
 */
export function firstFailureLines(output: string, maxLines = 6, maxChars = 800): string {
  const lines = output.split(/\r?\n/).map((l) => l.trimEnd()).filter((l) => l.trim() !== "");
  if (lines.length === 0) return "(the command produced no output)";
  const start = lines.findIndex((l) => FAILURE_MARKER_RE.test(l));
  const chosen = start >= 0 ? lines.slice(start, start + maxLines) : lines.slice(-maxLines);
  return chosen.join("\n").slice(0, maxChars);
}

// ── "it did not pass here" is NOT "the repository is failing" ────────────────────────────────
//
// THE MISTAKE THIS SECTION EXISTS TO PREVENT. The verdict used to be called `baseline-red` and every
// sentence derived from it said "this repository's own check has failed" — the digest raised it as a
// standing concern, the next lane's brief led with repairing it, and a counter climbed to "attempt
// 14". It was false. `xkazm04/systedo-case` passes 3744/3744 in the operator's paired checkout; in a
// worktree cut from the same commit, with `node_modules` linked exactly as the lane links it, 8 tests
// fail and every one of them is `Could not load the default credentials …
// GoogleAuth.getApplicationDefaultAsync`.
//
// A worktree carries TRACKED FILES plus the dependency caches the loop links. Credentials, `.env`
// files, service configuration and a local database are gitignored and are correctly NOT linked. So a
// command that does not pass in a worktree tells you the guard cannot establish a baseline HERE, and
// nothing whatsoever about whether the repository's checks pass for the operator. Everything derived
// from the verdict must say that, and must not manufacture repair work out of it.
//
// `looksUnrunnable` still separates the sharpest case — the command could not START at all — because
// that shortens the sentence to one specific thing (a dependency tree the loop could not provide)
// instead of the general one. Both are the same verdict: no baseline, no blame.
//
// Loose on purpose, like the marker match above: the ONLY consequence of a false positive is one
// differently worded sentence in a note that is rendered exclusively for a command that failed.
const UNRUNNABLE_RE =
  /(cannot find module|module_not_found|modulenotfounderror|no module named|is not recognized as|command not found|not found: |missing script|could not determine executable|executable to run not found|is not installed|please run .{0,12}install|\bENOENT\b)/i;

/**
 * Did the command fail because it could not RUN in this checkout at all, rather than because it ran
 * and reported failures? Recognises the shapes a missing dependency tree produces across ecosystems:
 * node's `Cannot find module` / `ERR_MODULE_NOT_FOUND`, npm's `missing script` and `could not
 * determine executable to run`, a shell's `command not found` / `is not recognized as`, Python's
 * `ModuleNotFoundError: No module named`, and a bare `ENOENT` from a spawn.
 */
export function looksUnrunnable(output: string): boolean {
  return UNRUNNABLE_RE.test(output);
}
