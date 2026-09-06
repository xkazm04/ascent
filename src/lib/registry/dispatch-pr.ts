// Push a dispatch's branch and open its draft PR — the one step of a LOCAL dispatch that leaves
// the machine.
//
// WHY NEITHER EXISTING HELPER FITS. `openPrForLane` (src/lib/local/loop-pr.ts) refuses a lane with
// no dominant dimension and files the PR in the improvement ledger under one — a registry stage has
// no dimension and is not an improvement PR. `openDraftPr` (src/lib/github/write.ts) cuts a branch
// off base and PUTs ONE file through the Contents API; it cannot open a PR for a branch that already
// carries local commits (loop-pr.ts says exactly this in its header). So this is loop-pr's push +
// `/pulls` POST with the same 422-means-already-open reuse, minus the ledger.
//
// NEVER `--force`. A rejected push surfaces git's own words: a non-fast-forward needs a human.

import { runGit } from "@/lib/local/git";
import { AppApiError, githubAppFetch } from "@/lib/github/app";

export interface DispatchPrInput {
  token: string;
  owner: string;
  repo: string;
  /** The operator's paired checkout — the branch lives in its object store after the worktree is gone. */
  pairedPath: string;
  head: string;
  base: string;
  title: string;
  body: string;
}

export interface DispatchPrResult {
  prNumber: number;
  prUrl: string;
  /** An open PR for this head already existed and was returned instead of a new one. */
  reused: boolean;
}

const PUSH_TIMEOUT_MS = 120_000;

/** Push `head` from the paired checkout and open a draft PR to `base`. Throws with a plain message. */
export async function openDispatchPr(input: DispatchPrInput): Promise<DispatchPrResult> {
  const { owner, repo, head, base, token } = input;
  const pushed = await runGit(input.pairedPath, ["push", "--set-upstream", "origin", head], { timeoutMs: PUSH_TIMEOUT_MS });
  if (!pushed.ok) throw new Error(`Could not push ${head}: ${(pushed.stderr || pushed.stdout).slice(0, 400)}`);

  try {
    const pr = await githubAppFetch<{ html_url: string; number: number }>(`/repos/${owner}/${repo}/pulls`, token, {
      method: "POST",
      body: JSON.stringify({ title: input.title, head, base, body: input.body, draft: true }),
    });
    return { prNumber: pr.number, prUrl: pr.html_url, reused: false };
  } catch (err) {
    if (!(err instanceof AppApiError && err.status === 422)) throw err;
    const open = await githubAppFetch<{ html_url: string; number: number }[]>(
      `/repos/${owner}/${repo}/pulls?head=${encodeURIComponent(`${owner}:${head}`)}&state=open`,
      token,
    );
    if (!open[0]) throw err;
    return { prNumber: open[0].number, prUrl: open[0].html_url, reused: true };
  }
}
