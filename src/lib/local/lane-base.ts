// WHAT THE LOOP CAN HONESTLY KNOW ABOUT THE TWO ENDS OF A LANE'S PAIR — did they sit on the same
// line of history, or did the tree move under them?
//
// THE FAILURE THIS ANSWERS. Run a97baf88 (2026-08-30): `kp` read 92 → 84 and the sheet printed two
// `regressed` deliverables. Nothing the loop did caused it. Between the before-scan and the
// after-scan a PERSON switched the paired checkout from `autopilot/session-read-transcript-and-tree`
// to `main` — two different trees — and the lane's branch was cut from the second one. The
// subtraction was arithmetic over two unrelated measurements, published as a claim about the lane.
//
// WHAT IS ACTUALLY KNOWABLE, and nothing beyond it. A scan records `headSha` (`ComparableScan`), the
// commit it pinned to — that is the ONLY base evidence either end carries; there is no branch column
// on a Scan and none is invented here. So the narrowest honest question is asked of git, in the
// checkout that has both objects:
//
//     is the BEFORE commit an ancestor of the AFTER commit?
//
// Yes (or the same commit) — the after tree is the before tree plus history, which is exactly what a
// lane's own work looks like, and the pair is comparable. No, with BOTH commits present in the
// repository — the two ends genuinely diverge, and no delta may be claimed. Anything else —
// a missing `headSha`, a commit this checkout does not have, no git at all, a caller with no checkout
// to ask — is `unknown`, and unknown NEVER refuses. An unknown base is not a differing base, and only
// the latter is evidence of anything.
//
// The verdict itself lives in `maturity/attribution.ts` (`BaseRelation`), which stays pure; this
// module is the one impure half — two bounded `runGit` calls — so the rule can be table-tested
// without a repository.

import { runGit } from "@/lib/local/git";
import type { BaseRelation } from "@/lib/maturity/attribution";

/** The two ends as this rule reads them. `ComparableScan` satisfies it structurally. */
export interface BaseEnd {
  headSha: string | null;
}

/** The git seam, injected in tests. `ok` is all a caller needs: `runGit` never throws. */
export type GitAsk = (args: readonly string[]) => Promise<boolean>;

/**
 * Does this checkout have `sha` as a commit? The `^{commit}` peel matters: a sha that resolves to a
 * tree or a tag is not something `merge-base` can answer about, and treating it as present would turn
 * a git error into a false `diverged`.
 */
const hasCommit = (ask: GitAsk, sha: string): Promise<boolean> => ask(["cat-file", "-e", `${sha}^{commit}`]);

/**
 * The relation between a lane's two scan ends, decided by git.
 *
 * Order is the whole of the honesty here. Both commits are proven PRESENT before ancestry is asked,
 * because `git merge-base --is-ancestor` reports "no" and "I have never heard of that commit" the
 * same way through `runGit` (which surfaces only `ok`). Without the presence check, a garbage-
 * collected or never-fetched sha would read as a divergence and refuse a pair nobody has any
 * evidence against.
 */
export async function baseRelation(
  before: BaseEnd | null | undefined,
  after: BaseEnd | null | undefined,
  ask: GitAsk,
): Promise<BaseRelation> {
  const b = before?.headSha?.trim();
  const a = after?.headSha?.trim();
  // A pair with an unrecorded end says nothing about bases. This is the ordinary case for any scan
  // taken without a sha, and it is emphatically not a divergence.
  if (!b || !a) return "unknown";
  if (b === a) return "shared";
  if (!(await hasCommit(ask, b)) || !(await hasCommit(ask, a))) return "unknown";
  return (await ask(["merge-base", "--is-ancestor", b, a])) ? "shared" : "diverged";
}

/** The same question against a real checkout — the lane's worktree (which shares the paired
 *  repository's object store, so it has both commits) or the paired path itself. */
export function baseRelationIn(
  cwd: string,
  before: BaseEnd | null | undefined,
  after: BaseEnd | null | undefined,
): Promise<BaseRelation> {
  return baseRelation(before, after, async (args) => (await runGit(cwd, args)).ok).catch(() => "unknown" as const);
}
