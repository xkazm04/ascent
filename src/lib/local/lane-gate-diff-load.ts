// THE INTEGRITY GUARD'S EVIDENCE — the git-and-disk half of `lane-gate-diff.ts`.
//
// The guard itself stays pure: it judges paths. What lets it tell a lane that ADDED a test from one
// that WEAKENED one is evidence only a repository can supply — each path's git status, the committed
// text of an added test, and the verify ladder as it resolved before and after the lane. This module
// gathers it, and every way it can fail degrades to an ABSENT field, which the guard reads as strict.
// So a broken read can only void more lanes, never fewer.

import { readVerifyInputs } from "@/lib/local/lane-guard";
import { resolveVerifyLadder, VERIFY_GUIDANCE_PATHS, VERIFY_MANIFEST_PATH } from "@/lib/local/lane-verify";
import {
  classifyScoringSurface,
  needsAddedText,
  needsVerifyLadder,
  parseNameStatus,
  type GateDiffOptions,
} from "@/lib/local/lane-gate-diff";

type Git = (args: readonly string[]) => Promise<{ ok: boolean; stdout: string }>;

/** How many added test files are read. Past this, the rest stay unread — and therefore void. */
const MAX_ADDED_READS = 40;

const lc = (p: string): string => p.replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();

/**
 * Gather the evidence for `checkGateDiff(changedPaths, evidence)`. `before` is the lane's base commit;
 * `dir` is its worktree, whose HEAD carries the lane's commits. Never throws.
 */
export async function readGateDiffEvidence(args: {
  git: Git;
  dir: string;
  before: string;
  changedPaths: readonly string[];
}): Promise<GateDiffOptions> {
  const { git, dir, before, changedPaths } = args;
  // Nothing on the scoring surface: nothing to clear, so no reads at all.
  if (!changedPaths.some((p) => classifyScoringSurface(p))) return {};
  const out: GateDiffOptions = {};
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

    const guidance = changedPaths.filter(needsVerifyLadder);
    if (guidance.length > 0) out.verifyLadder = await ladderAcross(git, dir, before, guidance, statuses);
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
