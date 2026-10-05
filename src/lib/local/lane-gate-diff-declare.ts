// THE THREE GATE-DECLARATION MOVES THE INTEGRITY GUARD CLEARS — pure, beside `lane-gate-diff.ts`.
//
// All three were measured as wrong voids on 2026-10-05, the standing runner's first day on game repos:
//
//   • garden-vr ADDED `tools/guard/check.mjs`, a new pre-commit guard script. A gate script is
//     classed by NAME, so the lane was void — although the resolved verify command (`dotnet test
//     shared/core-dotnet`) referenced no such file, before or after. A NEW script that neither ladder
//     runs cannot have flattered this lane. `rungReferencing` is that check; a referenced one still
//     voids, and a modified or deleted one voids exactly as before (a body can change under a name).
//   • firetv rewrote AGENTS.md / `.ai/manifest.yaml` / CONTRIBUTING.md to DECLARE the repository's
//     real gates, so the resolved command changed and the lane was void. But the lane's own verdict
//     was measured with the PRE-change command (the baseline is cached per worktree, lane-guard.ts),
//     so the lane was not measured by its own edit — and declaring the real gate is the single most
//     valuable "make this repo AI-ready" move, the one the guard's own no-baseline note asks for.
//     Cleared only when the lane was measured with the OLD command, the NEW one is not vacuous, and
//     the new one PASSES on the lane's committed tree (run once by the loader).
//   • mage-arena (Unreal, no resolvable check) declared its FIRST gate. Going from no gate to a gate
//     weakens nothing, and without this a no-check repository can never acquire one through the loop.
//     A BOOTSTRAP is cleared when the lane's verdict was the no-check one, the new primary is not
//     vacuous, and a rung of the new ladder passes on the committed tree (tried in order; the one
//     that passed is named). The call site then upgrades `skipped` to `verified` against it.
//
// Anything else — a removed gate, a narrowed verdict, an unrun or failing new command — voids.
// Clearing is not silence: the call site logs the change (`gateChangeSentence`) so the human who
// merges the runner branch reviews the new gate. That merge is the human gate; only architecture waits.

import type { ResolvedVerify } from "@/lib/local/lane-verify";

type Rung = Pick<ResolvedVerify, "command" | "rung">;

/** A script the gate calls, by shape: `scripts/verify.mjs`, `tools/guard/check.mjs`, `bin/ci.ps1`.
 *  Takes a normalized (forward-slash, lowercased) path. */
export function isGateScriptPath(p: string): boolean {
  const segs = p.split("/").filter(Boolean);
  const dir = segs[0];
  return (dir === "scripts" || dir === "bin" || dir === "tools") && /^(verify|check|ci|gate|lint|test)\b/.test(segs.at(-1) ?? "");
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const stripExt = (s: string): string => s.replace(/\.[^./]+$/, "");

/**
 * The first rung, across `ladders`, whose command text names this (normalized) script — or null.
 * Matched as a TOKEN on the path, the path without its extension, the basename and the basename
 * without its extension. The last is the coarse one on purpose: `npm run check` can reach
 * `tools/check.mjs` through a script body this module never sees, so a coincidental word voids.
 */
export function rungReferencing(p: string, ladders: readonly (readonly Rung[])[]): string | null {
  const b = p.split("/").at(-1) ?? "";
  const tokens = [...new Set([p, stripExt(p), b, stripExt(b)].filter(Boolean))];
  const res = tokens.map((t) => new RegExp(`(?<![a-z0-9_])${escapeRe(t)}(?![a-z0-9_])`));
  for (const ladder of ladders) {
    for (const r of ladder) {
      const cmd = r.command.replace(/\\/g, "/").toLowerCase();
      if (res.some((re) => re.test(cmd))) return r.command;
    }
  }
  return null;
}

/** The lane's own guard verdict and the command it ran (the row's `verifyVerdict` / `verifyCommand`). */
export interface LaneVerdictEvidence {
  verdict: string;
  command: string | null;
}

/** One rung of the NEW ladder, run once on the lane's committed tree by the loader. */
export interface DeclaredGateRun extends Rung {
  ok: boolean;
  timedOut: boolean;
}

/** A cleared change of the declared gate — what the call site logs for the reviewer. */
export interface GateChange {
  /** The old primary; null for a bootstrap (nothing resolved before). */
  from: string | null;
  /** The new primary, as declared. */
  to: string;
  /** The command that PASSED on the lane's tree, and its rung — `to` itself unless a bootstrap narrowed. */
  passed: string;
  rung: Rung["rung"];
  /** The guidance/manifest paths that declared it. */
  files: string[];
  /** How the lane was measured before the change: a verified pass, no baseline, or no gate at all. */
  measured: "verified" | "baseline-unavailable" | "bootstrap";
}

/** Commands that check nothing. A new gate made only of these would pass anywhere. */
const VACUOUS = new Set(["echo", "echo.", "true", "exit", ":", "rem", "cd", "ls", "dir"]);

/** Is every segment of this command (split on `&&`, `||`, `;`, `|`, `&`) one of `VACUOUS`? */
export function isVacuousCommand(command: string): boolean {
  const parts = command
    .split(/&&|\|\||[;|&\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.every((seg) => VACUOUS.has((seg.split(/\s+/)[0] ?? "").replace(/^@/, "").toLowerCase()));
}

type Ladder = { before: readonly Rung[]; after: readonly Rung[] };
type Verdict = LaneVerdictEvidence | null | undefined;

/** Why the change cannot be cleared whatever the new gate does, or null when it may be run. */
function refusalBeforeRun(ladder: Ladder, verdict: Verdict): string | null {
  const from = ladder.before[0];
  const to = ladder.after[0];
  if (!to) return "it leaves no verify command resolved";
  if (!from) {
    // A BOOTSTRAP. The no-check verdict (`skipped`, or verified by construction — nothing ran) is the
    // one a first gate replaces; no verdict at all means the guard was off, and then nothing is run.
    const noCheck = verdict && verdict.command == null && (verdict.verdict === "skipped" || verdict.verdict === "verified");
    if (!noCheck) return "no verify command resolved before it, and this lane's verdict was not the no-check one a first gate replaces";
  } else {
    if (from.rung !== "primary") return "no primary verify command resolved before it";
    if (from.command === to.command) return "it changes the narrower fallbacks, not the declared command";
    const measured = verdict && (verdict.verdict === "verified" || verdict.verdict === "baseline-unavailable");
    if (!measured || verdict.command !== from.command) return `this lane's verdict was not reached with \`${from.command}\``;
  }
  if (isVacuousCommand(to.command)) return `\`${to.command}\` checks nothing`;
  return null;
}

/** The rungs the loader should run, in order, stopping at the first pass: the new primary for a
 *  change, every non-vacuous rung for a bootstrap. Empty when the change voids regardless. */
export function declaredGateCommands(ladder: Ladder, verdict: Verdict): Rung[] {
  if (refusalBeforeRun(ladder, verdict)) return [];
  const to = ladder.after[0]!;
  if (ladder.before.length > 0) return [{ command: to.command, rung: to.rung }];
  return ladder.after.filter((r) => !isVacuousCommand(r.command)).map((r) => ({ command: r.command, rung: r.rung }));
}

/** Clear a changed or first declared gate (header), or say why not. `files` is filled by the caller. */
export function judgeDeclaredGate(
  ladder: Ladder,
  verdict: Verdict,
  runs: readonly DeclaredGateRun[] | null | undefined,
): { change: Omit<GateChange, "files"> } | { refused: string } {
  const refused = refusalBeforeRun(ladder, verdict);
  if (refused) return { refused };
  const wanted = declaredGateCommands(ladder, verdict);
  const tried = (runs ?? []).filter((r) => wanted.some((w) => w.command === r.command));
  const passed = wanted.map((w) => tried.find((r) => r.command === w.command && r.ok)).find(Boolean);
  const to = ladder.after[0]!.command;
  if (!passed) {
    if (tried.length === 0) return { refused: `\`${to}\` was not run on this lane's tree` };
    const how = tried.map((r) => `\`${r.command}\` ${r.timedOut ? "timed out" : "failed"}`).join(", ");
    return { refused: `the newly declared gate does not pass here (${how} on this lane's tree)` };
  }
  const from = ladder.before[0]?.command ?? null;
  const measured = from == null ? "bootstrap" : verdict!.verdict === "verified" ? "verified" : "baseline-unavailable";
  return { change: { from, to, passed: passed.command, rung: passed.rung, measured } };
}

const narrowedClause = (c: GateChange): string =>
  c.passed === c.to ? "" : ` (the declared \`${c.to}\` did not pass here; its ${c.rung} rung \`${c.passed}\` did)`;

/** The lane-log line a cleared gate change leaves for the reviewer of the runner branch. */
export function gateChangeSentence(c: GateChange): string {
  const files = c.files.join(", ");
  if (c.measured === "bootstrap") {
    return (
      `Gate declared: \`${c.to}\` (declared in ${files}) is this repository's FIRST verify gate — nothing resolved before it, ` +
      `so nothing existing could regress against it; it passes on this lane's tree${narrowedClause(c)}, and every later run is ` +
      `verified against it — review it when merging the runner branch.`
    );
  }
  const how =
    c.measured === "verified"
      ? `this lane was verified against \`${c.from}\``
      : `this lane was measured against \`${c.from}\`, which established no baseline on its worktree`;
  return (
    `Gate changed: \`${c.from}\` -> \`${c.to}\` (declared in ${files}); ${how}, \`${c.to}\` passes on its tree, ` +
    `and every later run is verified against \`${c.to}\` — review it when merging the runner branch.`
  );
}

/** The verify note a BOOTSTRAP writes when it upgrades the lane's `skipped` to `verified`. */
export function bootstrapVerifyNote(c: GateChange): string {
  return (
    `Verified against the gate this lane DECLARED (bootstrap): before this lane the repository declared no check the loop ` +
    `could resolve, so there was no prior gate and nothing existing could regress against it. \`${c.passed}\` ` +
    `(${c.rung}${c.passed === c.to ? "" : `, a narrower rung of the declared \`${c.to}\`, which did not pass here`}; ` +
    `declared in ${c.files.join(", ")}) passes on the lane's committed result. ` +
    `It is the repository's first check; merging the runner branch is the human review.`
  );
}
