// THE INTEGRITY GUARD'S EVIDENCE — the git-and-disk half of `lane-gate-diff.ts`.
//
// The guard itself stays pure: it judges paths. What lets it tell a lane that ADDED a test from one
// that WEAKENED one is evidence only a repository can supply — each path's git status, the committed
// text of an added test, and the verify ladder as it resolved before and after the lane. This module
// gathers it, and every way it can fail degrades to an ABSENT field, which the guard reads as strict.
// So a broken read can only void more lanes, never fewer.
//
// ONE READ RUNS A COMMAND. When a guidance edit changed the resolved verify command (or declared the
// first one) and every other condition for clearing it holds (`declaredGateCommands`), the NEW gate
// is run on the lane's committed tree, under the lane's own verify timeout — its primary only for a
// change, its rungs in order until one passes for a bootstrap. That is the same repo-authored execution the
// degradation guard already performs in this worktree (lane-guard.ts header), not a new capability.

import { readVerifyInputs, runVerifyCommand, type VerifyRun } from "@/lib/local/lane-guard";
import { resolveVerifyLadder, VERIFY_GUIDANCE_PATHS, VERIFY_MANIFEST_PATH } from "@/lib/local/lane-verify";
import {
  classifyScoringSurface,
  isAddedGateScriptCandidate,
  needsAddedText,
  needsVerifyLadder,
  parseNameStatus,
  type GateDiffOptions,
  type LaneVerdictEvidence,
} from "@/lib/local/lane-gate-diff";
import { declaredGateCommands, type DeclaredGateRun } from "@/lib/local/lane-gate-diff-declare";

type Git = (args: readonly string[]) => Promise<{ ok: boolean; stdout: string }>;

/** How many added test files are read. Past this, the rest stay unread — and therefore void. */
const MAX_ADDED_READS = 40;

const lc = (p: string): string => p.replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();

/**
 * Gather the evidence for `checkGateDiff(changedPaths, evidence)`. `before` is the lane's base commit;
 * `dir` is its worktree, whose HEAD carries the lane's commits. `laneVerdict` is the lane's own guard
 * verdict and command, and `verifyMs` its verify timeout; without both a changed gate stays void.
 * Never throws.
 */
export async function readGateDiffEvidence(args: {
  git: Git;
  dir: string;
  before: string;
  changedPaths: readonly string[];
  laneVerdict?: LaneVerdictEvidence | null;
  verifyMs?: number;
  /** Test seam; the degradation guard's own runner by default. */
  run?: (dir: string, command: string, timeoutMs: number) => Promise<VerifyRun>;
}): Promise<GateDiffOptions> {
  const { git, dir, before, changedPaths, laneVerdict = null, verifyMs = 0 } = args;
  // Nothing on the scoring surface: nothing to clear, so no reads at all.
  if (!changedPaths.some((p) => classifyScoringSurface(p))) return {};
  const out: GateDiffOptions = laneVerdict ? { laneVerdict } : {};
  try {
    // --no-renames: a MOVED test reads as a delete plus an add, and the delete still voids.
    const ns = await git(["diff", "--name-status", "--no-renames", "-z", `${before}..HEAD`]);
    const statuses = ns.ok ? parseNameStatus(ns.stdout) : {};
    out.statuses = statuses;

    const added = changedPaths.filter((p) => statuses[p] === "A" && needsAddedText(p)).slice(0, MAX_ADDED_READS);
    if (added.length > 0) {
      const addedText: Record<string, string | null> = {};
      for (const p of added) {
        const shown = await git(["show", `HEAD:${p}`]);
        addedText[p] = shown.ok ? shown.stdout : null;
      }
      out.addedText = addedText;
    }

    // The ladder is read for a guidance edit (did the command change?) and for ANY changed gate script —
    // added, modified or deleted — (does either side's command run it?). Reading it only for an added
    // one left a modified, unreferenced script "could not be read" and voided (measured 2026-10-05).
    // Only the guidance files are swapped for `before`'s text.
    const guidance = changedPaths.filter(needsVerifyLadder);
    // ...and for any changed gate CONFIG, so an added one no rung can read can be cleared (lane-gate-diff.ts).
    const addedScript = changedPaths.some((p) => isAddedGateScriptCandidate(p) || classifyScoringSurface(p) === "gate-config");
    if (guidance.length > 0 || addedScript) out.verifyLadder = await ladderAcross(git, dir, before, guidance, statuses);

    // A changed (or first) declared gate is run on the committed tree, rung by rung, until one passes.
    // The runner is resolved HERE, inside the try, so a caller that never needs it never touches it.
    const toRun = guidance.length > 0 && out.verifyLadder ? declaredGateCommands(out.verifyLadder, laneVerdict) : [];
    if (toRun.length > 0 && verifyMs > 0) {
      const run = args.run ?? runVerifyCommand;
      const runs: DeclaredGateRun[] = [];
      for (const { command, rung } of toRun) {
        const r = await run(dir, command, verifyMs).catch((): VerifyRun => ({ ok: false, output: "", timedOut: false }));
        runs.push({ command, rung, ok: r.ok, timedOut: r.timedOut, output: r.output });
        if (r.ok) break;
      }
      out.declaredGateRuns = runs;
    }
  } catch {
    // Whatever was gathered stands; whatever was not is absent, which is strict.
  }
  return out;
}

/**
 * The verify ladder at HEAD and at `before`. HEAD's inputs are read from the worktree exactly as the
 * degradation guard reads them; `before`'s are the same inputs with each CHANGED guidance file swapped
 * for its text at `before` — the unchanged ones are identical by definition, and the non-guidance
 * declarations (`package.json`, toolchain) void on their own if the lane touched them. Null when a
 * `before` read fails for any reason other than the file being new, so the guard stays strict.
 */
async function ladderAcross(
  git: Git,
  dir: string,
  before: string,
  changed: readonly string[],
  statuses: Readonly<Record<string, string>>,
): Promise<GateDiffOptions["verifyLadder"]> {
  const head = await readVerifyInputs(dir);
  const after = resolveVerifyLadder(head);

  /** The `before` text of the changed file at the canonical root path, or `keep` if none changed. */
  const atBefore = async (canonical: string, keep: string | null): Promise<string | null | undefined> => {
    const c = changed.find((p) => lc(p) === canonical.toLowerCase());
    if (!c) return keep;
    const shown = await git(["show", `${before}:${c}`]);
    if (shown.ok) return shown.stdout;
    return statuses[c] === "A" ? null : undefined; // undefined = unreadable, not absent
  };

  const manifestYaml = await atBefore(VERIFY_MANIFEST_PATH, head.manifestYaml);
  if (manifestYaml === undefined) return null;
  const guidance: { path: string; text: string }[] = [];
  for (const rel of VERIFY_GUIDANCE_PATHS) {
    const text = await atBefore(rel, head.guidance.find((g) => g.path === rel)?.text ?? null);
    if (text === undefined) return null;
    if (text) guidance.push({ path: rel, text });
  }
  return { before: resolveVerifyLadder({ ...head, manifestYaml, guidance }), after };
}
