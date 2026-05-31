// Write surface for the GitHub App — opens a draft PR that seeds a generated starter artifact
// into a target repo (the Practice Library's "systematic apply"). Uses the installation token, so
// it only works for repos the customer installed Ascent on with `contents: write` +
// `pull_requests: write` permissions. Every step degrades to a clear AppApiError the route maps
// to a friendly message.
//
// Flow: resolve base sha → create (or reuse) a branch → create/update the file via the Contents
// API → open a draft PR (or return the already-open one for this head).

import { AppApiError, githubAppFetch } from "@/lib/github/app";

export interface OpenPrInput {
  token: string; // installation access token
  owner: string;
  repo: string;
  /** Branch to create the change on (created off `base`). */
  branch: string;
  /** Base branch to target; resolved to the repo default when omitted. */
  base?: string;
  path: string;
  content: string;
  commitMessage: string;
  prTitle: string;
  prBody: string;
}

export interface OpenPrResult {
  url: string; // html_url of the PR
  number: number;
  branch: string;
  /** True when an existing open PR for this head was returned instead of creating a new one. */
  reused: boolean;
}

const enc = (s: string) => Buffer.from(s, "utf8").toString("base64");

async function resolveBaseBranch(token: string, owner: string, repo: string, base?: string): Promise<string> {
  if (base) return base;
  const meta = await githubAppFetch<{ default_branch: string }>(`/repos/${owner}/${repo}`, token);
  return meta.default_branch;
}

async function refSha(token: string, owner: string, repo: string, branch: string): Promise<string> {
  const ref = await githubAppFetch<{ object: { sha: string } }>(
    `/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(branch)}`,
    token,
  );
  return ref.object.sha;
}

/** Existing file sha on a branch (needed to update), or null when the file doesn't exist there. */
async function existingFileSha(token: string, owner: string, repo: string, path: string, branch: string): Promise<string | null> {
  try {
    const file = await githubAppFetch<{ sha: string }>(
      `/repos/${owner}/${repo}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(branch)}`,
      token,
    );
    return file.sha ?? null;
  } catch (err) {
    if (err instanceof AppApiError && err.status === 404) return null;
    throw err;
  }
}

/**
 * Open a draft PR seeding `content` at `path`. Idempotent enough to retry: a pre-existing branch
 * is reused, a pre-existing file on it is updated, and if a PR is already open for the head we
 * return it rather than erroring. Requires the installation to grant contents + PR write.
 */
export async function openDraftPr(input: OpenPrInput): Promise<OpenPrResult> {
  const { token, owner, repo, branch, path, content, commitMessage, prTitle, prBody } = input;
  const base = await resolveBaseBranch(token, owner, repo, input.base);
  const baseSha = await refSha(token, owner, repo, base);

  // Create the branch off base; tolerate "already exists" so a re-run reuses it.
  try {
    await githubAppFetch(`/repos/${owner}/${repo}/git/refs`, token, {
      method: "POST",
      body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: baseSha }),
    });
  } catch (err) {
    if (!(err instanceof AppApiError && err.status === 422)) throw err;
  }

  // Create or update the file on the branch.
  const sha = await existingFileSha(token, owner, repo, path, branch);
  await githubAppFetch(`/repos/${owner}/${repo}/contents/${path.split("/").map(encodeURIComponent).join("/")}`, token, {
    method: "PUT",
    body: JSON.stringify({ message: commitMessage, content: enc(content), branch, ...(sha ? { sha } : {}) }),
  });

  // Open a draft PR — or return the already-open one for this head.
  try {
    const pr = await githubAppFetch<{ html_url: string; number: number }>(`/repos/${owner}/${repo}/pulls`, token, {
      method: "POST",
      body: JSON.stringify({ title: prTitle, head: branch, base, body: prBody, draft: true }),
    });
    return { url: pr.html_url, number: pr.number, branch, reused: false };
  } catch (err) {
    if (err instanceof AppApiError && err.status === 422) {
      const open = await githubAppFetch<{ html_url: string; number: number }[]>(
        `/repos/${owner}/${repo}/pulls?head=${encodeURIComponent(`${owner}:${branch}`)}&state=open`,
        token,
      );
      if (open[0]) return { url: open[0].html_url, number: open[0].number, branch, reused: true };
    }
    throw err;
  }
}
