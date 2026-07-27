// Deliver the generated `.ai/` foundation into a repo as ONE draft PR — the install path that
// replaces "download SKILL.md and hand-transcribe ~14KB of fenced code blocks".
//
// It deliberately LAYERS on the existing PR machinery (`openDraftPr` in @/lib/github/write) instead
// of forking a second GitHub client: every file is seeded through the same installation-token flow,
// the same never-clobber-a-base-file guard, and the same branch/PR reuse semantics. `openDraftPr` is
// single-file, so we call it once per generated file against ONE branch: the first call creates the
// branch + the draft PR, each later call reuses the branch (its `refs` create tolerates 422) and
// returns the already-open PR for that head. The result is one PR with one commit per file.
//
// Cost note: this is N sequential round-trip sets (~8 requests per file). It is correct and reuses
// the audited write path; if the file count grows materially, the right optimization is a batch
// (git trees/commits) variant inside @/lib/github/write, NOT a parallel client here.

import { AppApiError } from "@/lib/github/app";
import { openDraftPr, type OpenPrResult } from "@/lib/github/write";
import type { GeneratedFile } from "./types";

/** Branch every foundation PR is cut on — stable, so a re-run updates the same PR. */
export const FOUNDATION_BRANCH = "ascent/ai-foundation";

export interface FoundationPrResult extends OpenPrResult {
  /** Repo-relative paths actually committed to the branch, in scaffold order. */
  committed: string[];
  /** Paths skipped because the repo already has a real file there on the base branch. */
  skipped: string[];
}

export interface OpenFoundationPrInput {
  token: string;
  owner: string;
  repo: string;
  base?: string;
  /** The generated tree, spine first (see buildFoundation). */
  files: GeneratedFile[];
  prTitle: string;
  prBody: string;
}

/**
 * Seed every generated file onto one branch and open (or reuse) a single draft PR.
 *
 * Collision policy, layered on `openDraftPr`'s 409 base-file guard:
 *  - the SPINE (`files[0]`, `.ai/manifest.yaml`) colliding means the standard is already installed —
 *    the 409 propagates so the caller can say so, and nothing is written.
 *  - any LATER file colliding is a pre-existing real file (a repo may well already have a root
 *    `CONTEXT.md` or its own workflow). We never overwrite it: the path is skipped and reported, and
 *    the rest of the foundation still lands. Refusing the whole PR over one such file would make the
 *    install unreachable for exactly the repos most likely to want it.
 */
export async function openFoundationPr(input: OpenFoundationPrInput): Promise<FoundationPrResult> {
  const { token, owner, repo, base, files, prTitle, prBody } = input;
  if (files.length === 0) throw new Error("openFoundationPr: no files to seed");

  const committed: string[] = [];
  const skipped: string[] = [];
  let pr: OpenPrResult | null = null;

  for (const [i, f] of files.entries()) {
    try {
      pr = await openDraftPr({
        token,
        owner,
        repo,
        branch: FOUNDATION_BRANCH,
        base,
        path: f.path,
        content: f.body,
        commitMessage: `chore(.ai): add ${f.path} (via Ascent)`,
        prTitle,
        prBody,
      });
      committed.push(f.path);
    } catch (err) {
      if (i > 0 && err instanceof AppApiError && err.status === 409) {
        skipped.push(f.path);
        continue;
      }
      throw err;
    }
  }

  // Unreachable unless every file after the spine threw a non-409 (which rethrows above).
  if (!pr) throw new Error("openFoundationPr: no pull request was opened");
  return { ...pr, committed, skipped };
}
