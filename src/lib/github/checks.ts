// GitHub App write surface for the PR maturity gate: a Check Run (the pass/fail status that can
// block merge) + a sticky PR comment (updated in place, never stacked). Both use the installation
// token and need `checks: write` + `pull_requests: write`. Pure rendering lives in
// scoring/gate-comment.ts; this module only performs the I/O.

import { AppApiError, githubAppFetch } from "@/lib/github/app";

export interface CheckRunInput {
  token: string;
  owner: string;
  repo: string;
  headSha: string;
  name?: string;
  conclusion: "success" | "failure" | "neutral";
  title: string;
  summary: string;
  /** Optional deep link surfaced on the check (e.g. the Ascent report). */
  detailsUrl?: string;
}

/** Create a completed Check Run on a commit. Returns the run's html_url. */
export async function createCheckRun(input: CheckRunInput): Promise<{ url: string; id: number }> {
  const { token, owner, repo, headSha } = input;
  const run = await githubAppFetch<{ html_url: string; id: number }>(`/repos/${owner}/${repo}/check-runs`, token, {
    method: "POST",
    body: JSON.stringify({
      name: input.name ?? "Ascent maturity gate",
      head_sha: headSha,
      status: "completed",
      conclusion: input.conclusion,
      ...(input.detailsUrl ? { details_url: input.detailsUrl } : {}),
      output: { title: input.title, summary: input.summary },
    }),
  });
  return { url: run.html_url, id: run.id };
}

export interface StickyCommentInput {
  token: string;
  owner: string;
  repo: string;
  /** PR number (PRs are issues for the comments API). */
  prNumber: number;
  /** Hidden marker that identifies a prior bot comment to update. */
  marker: string;
  body: string;
}

/**
 * Upsert a sticky comment on a PR: find the bot's prior comment by `marker` and PATCH it, else
 * POST a new one. Scans the first few pages of comments (newest activity is usually early; bound
 * the search so a long thread can't make this unbounded). Returns the comment's html_url.
 */
export async function upsertStickyComment(input: StickyCommentInput): Promise<{ url: string; updated: boolean }> {
  const { token, owner, repo, prNumber, marker, body } = input;
  const PER_PAGE = 100;
  const MAX_PAGES = 5;

  let existingId: number | null = null;
  for (let page = 1; page <= MAX_PAGES && existingId == null; page++) {
    const comments = await githubAppFetch<{ id: number; body: string }[]>(
      `/repos/${owner}/${repo}/issues/${prNumber}/comments?per_page=${PER_PAGE}&page=${page}`,
      token,
    );
    const hit = comments.find((c) => typeof c.body === "string" && c.body.includes(marker));
    if (hit) existingId = hit.id;
    if (comments.length < PER_PAGE) break;
  }

  if (existingId != null) {
    try {
      const updated = await githubAppFetch<{ html_url: string }>(
        `/repos/${owner}/${repo}/issues/comments/${existingId}`,
        token,
        { method: "PATCH", body: JSON.stringify({ body }) },
      );
      return { url: updated.html_url, updated: true };
    } catch (err) {
      // The prior comment may have been deleted between read and write — fall through to create.
      if (!(err instanceof AppApiError && err.status === 404)) throw err;
    }
  }

  const created = await githubAppFetch<{ html_url: string }>(
    `/repos/${owner}/${repo}/issues/${prNumber}/comments`,
    token,
    { method: "POST", body: JSON.stringify({ body }) },
  );
  return { url: created.html_url, updated: false };
}
