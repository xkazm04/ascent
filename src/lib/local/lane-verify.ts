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
//   2. The guidance files — `parseCommands` (src/lib/analyze/guidance-graph.ts), the SAME extraction
//      the scorer's `commands_agree` facet runs over CLAUDE.md / AGENTS.md / CONTRIBUTING.md. If the
//      repo tells its agents "run `npm run check`", that is the command it means.
//   3. `package.json` scripts — the conventional names, last, because a script that exists is weaker
//      evidence than a command the repository asked for in words.
//   4. Nothing resolvable → the guard is SKIPPED, and it says so on the lane. Never a silent pass:
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
export { VERIFY_VERDICTS, asVerifyVerdict, verifyVerdictTag, type VerifyVerdict } from "@/lib/local/verify-options";

/** A command the guard will run, and where the repository declared it. */
export interface ResolvedVerify {
  command: string;
  /** Human-readable provenance, printed on the lane: "`.ai/manifest.yaml` (ciHardPass)". */
  source: string;
}

/** The files the resolution reads, as text. All optional — a repository declaring none resolves to
 *  `null`, which is the SKIPPED verdict rather than a fallback command invented on its behalf. */
export interface VerifyInputs {
  manifestYaml?: string | null;
  /** Guidance documents in PRECEDENCE ORDER (CLAUDE.md, AGENTS.md, CONTRIBUTING.md). */
  guidance?: readonly { path: string; text: string }[];
  packageJson?: string | null;
}

/** A command must not be run when the manifest reader redacted a secret out of it, or when it still
 *  carries a `<placeholder>`: neither is a command the repository actually declared. */
const RUNNABLE = (c: string): boolean => c.trim().length > 0 && !c.includes("«redacted»") && !/<[^>]+>/.test(c);

/** At most three declared capabilities are chained. The manifest may wire a dozen; three is already
 *  the whole of a typical hard pass (typecheck, lint, test) and the guard has a ten-minute budget. */
const MAX_CHAINED = 3;

/**
 * The keys `parseCommands` produces, in the order the guard prefers them.
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
 * already wrote for itself.
 */
const SCRIPT_ORDER: readonly string[] = ["check:ci", "verify", "check", "ci", "test"];

function fromManifest(yaml: string | null | undefined): ResolvedVerify | null {
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

function fromGuidance(docs: readonly { path: string; text: string }[] | undefined): ResolvedVerify | null {
  for (const doc of docs ?? []) {
    if (!doc.text || !doc.text.trim()) continue;
    const found = parseCommands(doc.text);
    for (const key of GUIDANCE_KEY_ORDER) {
      const hit = found.find((c) => c.key === key && RUNNABLE(c.command));
      if (hit) return { command: hit.command.trim(), source: `${doc.path} (${key})` };
    }
  }
  return null;
}

function fromPackageJson(raw: string | null | undefined): ResolvedVerify | null {
  if (!raw || !raw.trim()) return null;
  let scripts: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(raw);
    const s = (parsed as { scripts?: unknown } | null)?.scripts;
    if (!s || typeof s !== "object" || Array.isArray(s)) return null;
    scripts = s as Record<string, unknown>;
  } catch {
    return null;
  }
  for (const name of SCRIPT_ORDER) {
    const body = scripts[name];
    if (typeof body !== "string" || body.trim() === "") continue;
    // `npm test` is the real invocation for the `test` script; every other name needs `run`.
    const command = name === "test" ? "npm test" : `npm run ${name}`;
    return { command, source: `package.json (scripts.${name})` };
  }
  return null;
}

/**
 * The repository's own verification command, or `null` when it declares none.
 *
 * Deterministic and total: same inputs, same answer, never a throw. A malformed manifest or an
 * unparseable `package.json` falls through to the next source rather than failing the resolution —
 * the guard's job is to find a check, and a broken declaration is not evidence that no check exists.
 */
export function resolveVerifyCommand(inputs: VerifyInputs): ResolvedVerify | null {
  return fromManifest(inputs.manifestYaml) ?? fromGuidance(inputs.guidance) ?? fromPackageJson(inputs.packageJson);
}

/** The paths the guard reads, in the order `resolveVerifyCommand` consults them. Exported so the
 *  reader in `lane-guard.ts` cannot drift from the resolver that consumes what it read. */
export const VERIFY_MANIFEST_PATH = ".ai/manifest.yaml";
export const VERIFY_GUIDANCE_PATHS: readonly string[] = ["CLAUDE.md", "AGENTS.md", "CONTRIBUTING.md"];
export const VERIFY_PACKAGE_PATH = "package.json";

// SUBSTRING, NOT WORD-BOUNDED, and deliberately. Runners concatenate: `AssertionError`, `TSError`,
// `ERR_MODULE_NOT_FOUND`, `error TS2345` — a `\berror\b` matches the last of those and none of the
// rest, which is exactly backwards. The cost of a loose match is a line of context in a note that is
// only ever rendered for a command that has already failed.
const FAILURE_RE = /(error|fail|✗|✕|×|assert|exception|cannot find|not found|panic|traceback|refus)/i;

/**
 * The first MEANINGFUL failure lines of a command's output — what the lane records so the operator
 * can see WHY the guard rejected without opening a worktree that no longer exists.
 *
 * Failure-shaped lines first (a test runner prints its summary at the end, a compiler prints its
 * errors as it goes), and when nothing matches, the TAIL: a command that failed with unrecognisable
 * output still said something last, and an empty note would be indistinguishable from "we did not
 * look". Bounded hard — this ends up in a database column and on a lane row.
 */
export function firstFailureLines(output: string, maxLines = 6, maxChars = 800): string {
  const lines = output.split(/\r?\n/).map((l) => l.trimEnd()).filter((l) => l.trim() !== "");
  if (lines.length === 0) return "(the command produced no output)";
  const hits = lines.filter((l) => FAILURE_RE.test(l)).slice(0, maxLines);
  const chosen = hits.length > 0 ? hits : lines.slice(-maxLines);
  return chosen.join("\n").slice(0, maxChars);
}
