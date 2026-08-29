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
import { classifyPrWriteError } from "@/lib/github/pr-route";
import { openDraftPr, type OpenPrResult } from "@/lib/github/write";
import { mapPool, SCAN_CONCURRENCY } from "@/lib/pool";
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

// ── Fleet fan-out ─────────────────────────────────────────────────────────────────────────────────
// One click installs the foundation across the repos an org just scanned, instead of N trips through
// the single-repo route. Deliberately the SAME contract as /api/practices/apply-batch, because this is
// the same act at a different scale: bounded concurrency so a big fleet neither hammers GitHub nor
// trips the function ceiling, and a per-repo try/catch so one bad repo can never abort the pool. The
// branch is unchanged (FOUNDATION_BRANCH), so a re-run UPDATES each repo's existing PR.

/** One repo's outcome in a batch. `ok:false` is a REPORTED failure, never a thrown one. */
export interface FoundationBatchItem {
  /** "owner/name" — always present, so a failed row is still attributable. */
  repo: string;
  ok: boolean;
  url?: string;
  number?: number;
  reused?: boolean;
  committed?: number;
  skipped?: string[];
  error?: string;
}

export interface OpenFoundationPrBatchInput {
  token: string;
  owner: string;
  base?: string;
  concurrency?: number;
  repos: Array<{ name: string; files: GeneratedFile[]; prTitle: string; prBody: string }>;
}

/**
 * Open (or update) the foundation PR in every repo of `repos`, at most `concurrency` at a time.
 *
 * Error policy, verbatim from apply-batch: the worker OWNS its errors. Every failure — a spine 409
 * ("already installed"), a 403 from an installation without write access, a network throw — becomes an
 * `ok:false` row with a classified message, so an N-repo batch always returns N rows and the caller can
 * answer 200 with an honest mixed result instead of losing the successes to one repo's exception.
 */
export async function openFoundationPrBatch(
  input: OpenFoundationPrBatchInput,
): Promise<FoundationBatchItem[]> {
  const { token, owner, base, repos } = input;
  const concurrency = Math.max(1, input.concurrency ?? SCAN_CONCURRENCY);
  return mapPool(repos, concurrency, async (r): Promise<FoundationBatchItem> => {
    const repo = `${owner}/${r.name}`;
    try {
      const pr = await openFoundationPr({
        token,
        owner,
        repo: r.name,
        base,
        files: r.files,
        prTitle: r.prTitle,
        prBody: r.prBody,
      });
      return {
        repo,
        ok: true,
        url: pr.url,
        number: pr.number,
        reused: pr.reused,
        committed: pr.committed.length,
        skipped: pr.skipped,
      };
    } catch (err) {
      // A 409 can only come from the SPINE (`.ai/manifest.yaml` already on base) — later collisions are
      // skipped inside openFoundationPr, not thrown — so it means "already installed here", which is the
      // single most useful thing a fleet row can say. Everything else goes through the shared PR-write
      // taxonomy so the copy matches the single-repo route exactly.
      const classified = classifyPrWriteError(err, { conflict: (e) => e.message });
      return { repo, ok: false, error: classified?.message ?? "Failed to open the foundation PR." };
    }
  });
}
