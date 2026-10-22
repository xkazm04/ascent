// Write surface for the GitHub App — opens a draft PR that seeds a generated starter artifact
// into a target repo (the Practice Library's "systematic apply"). Uses the installation token, so
// it only works for repos the customer installed Ascent on with `contents: write` +
// `pull_requests: write` permissions. Every step degrades to a clear AppApiError the route maps
// to a friendly message.
//
// Flow: resolve base sha → create (or reuse) a branch → create/update the file via the Contents
// API → open a draft PR (or return the already-open one for this head).

import { AppApiError, githubAppFetch } from "@/lib/github/app";
import { encodePathSegments } from "@/lib/github/host";
import { contentDigest } from "@/lib/registry/parse";

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
  /**
   * OPT-IN REVISION MODE (playbooks-1). Absent, a file already on base is refused (the guard below).
   * Present, a base file is replaced ONLY when its fetched content hashes (`contentDigest`) to this
   * value, i.e. it is byte-for-byte the file Ascent itself landed, and the PUT carries that file's blob
   * sha so a concurrent edit makes GitHub refuse. Different bytes, or no file at all, is a 409.
   */
  replaceIfBaseDigest?: string;
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
    `/repos/${owner}/${repo}/git/ref/heads/${encodePathSegments(branch)}`,
    token,
  );
  return ref.object.sha;
}

/** Existing file sha on a branch (needed to update), or null when the file doesn't exist there. */
async function existingFileSha(token: string, owner: string, repo: string, path: string, branch: string): Promise<string | null> {
  try {
    const file = await githubAppFetch<{ sha: string }>(
      `/repos/${owner}/${repo}/contents/${encodePathSegments(path)}?ref=${encodeURIComponent(branch)}`,
      token,
    );
    return file.sha ?? null;
  } catch (err) {
    if (err instanceof AppApiError && err.status === 404) return null;
    throw err;
  }
}

/** A file on a branch with its decoded text (null when GitHub did not inline it), or null if absent. */
async function existingFile(
  token: string, owner: string, repo: string, path: string, branch: string,
): Promise<{ sha: string; text: string | null } | null> {
  try {
    const file = await githubAppFetch<{ sha: string; content?: string; encoding?: string }>(
      `/repos/${owner}/${repo}/contents/${encodePathSegments(path)}?ref=${encodeURIComponent(branch)}`,
      token,
    );
    const text = typeof file.content === "string" && file.encoding === "base64" ? Buffer.from(file.content, "base64").toString("utf8") : null;
    return { sha: file.sha, text };
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

  // SAFETY: never clobber a file that already exists on the BASE branch. This opens a PR seeding a
  // STARTER artifact, so if the repo already has a real file at this path (SECURITY.md, ci.yml,
  // AGENTS.md, …) the branch — cut from base — carries it, and the create-or-update PUT below would
  // replace it with a TODO scaffold. Merging the PR then DELETES the customer's real content (and a
  // 25-repo batch fans that out fleet-wide from one click). A file existing only on OUR generated
  // branch from a prior run is fine (idempotent re-seed), so this checks BASE, not the branch.
  // Revision mode keeps this guard and narrows it for one case: the base file is exactly what Ascent
  // landed. `verified` is that file's blob sha, the one the PUT must carry.
  const replaceDigest = input.replaceIfBaseDigest;
  let verified: string | null = null;
  if (replaceDigest !== undefined) {
    const baseFile = await existingFile(token, owner, repo, path, base);
    if (!baseFile) {
      throw new AppApiError(409, path, `"${path}" is no longer on ${base}; refusing to re-create a file someone removed.`);
    }
    if (baseFile.text === null || contentDigest(baseFile.text) !== replaceDigest) {
      throw new AppApiError(409, path, `"${path}" changed since Ascent landed it on ${base}; refusing to overwrite edits made in the repo.`);
    }
    verified = baseFile.sha;
  }
  const baseFileSha = replaceDigest !== undefined ? null : await existingFileSha(token, owner, repo, path, base);
  if (baseFileSha) {
    throw new AppApiError(
      409,
      path,
      `"${path}" already exists on ${base}; refusing to overwrite it with a starter artifact.`,
    );
  }

  // Create the branch off base; tolerate "already exists" so a re-run reuses it.
  try {
    await githubAppFetch(`/repos/${owner}/${repo}/git/refs`, token, {
      method: "POST",
      body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: baseSha }),
    });
  } catch (err) {
    if (!(err instanceof AppApiError && err.status === 422)) throw err;
  }

  // Create or update the file on the branch. In revision mode the PUT carries the VERIFIED blob sha;
  // a reused branch that already carries these exact bytes (a retry) skips the write, and one carrying
  // any other bytes is refused rather than overwritten.
  let skipPut = false;
  let sha: string | null;
  if (verified !== null) {
    const onBranch = await existingFile(token, owner, repo, path, branch);
    if (onBranch && onBranch.sha !== verified) {
      if (onBranch.text === null || contentDigest(onBranch.text) !== contentDigest(content)) {
        throw new AppApiError(409, path, `"${path}" on ${branch} carries other changes; refusing to overwrite them.`);
      }
      skipPut = true;
    }
    sha = verified;
  } else {
    sha = await existingFileSha(token, owner, repo, path, branch);
  }
  if (!skipPut) {
    await githubAppFetch(`/repos/${owner}/${repo}/contents/${encodePathSegments(path)}`, token, {
      method: "PUT",
      body: JSON.stringify({ message: commitMessage, content: enc(content), branch, ...(sha ? { sha } : {}) }),
    });
  }

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

/** One PR's lifecycle state, as the merge monitor needs it. GitHub reports `state` as only
 *  open|closed — `merged` is the flag that distinguishes a landed PR from a rejected one. */
export interface PullRequestState {
  state: "open" | "closed";
  merged: boolean;
  mergedAt: string | null;
  closedAt: string | null;
}

/**
 * Read one PR's state — the merge-monitor counterpart of openDraftPr. The ship loop polls this
 * (bounded, from the visible war-room wall) to detect a starter PR landing so it can rescan the
 * repo and measure the score impact. Read-only; needs only the installation's PR read scope.
 */
export async function getPullRequest(token: string, owner: string, repo: string, number: number): Promise<PullRequestState> {
  const pr = await githubAppFetch<{ state: "open" | "closed"; merged: boolean; merged_at: string | null; closed_at: string | null }>(
    `/repos/${owner}/${repo}/pulls/${number}`,
    token,
  );
  return { state: pr.state, merged: Boolean(pr.merged), mergedAt: pr.merged_at, closedAt: pr.closed_at };
}
