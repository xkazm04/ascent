// Open (or update) the PR that contributes `signals/<contributor>.json` back to the customer's
// registry (#18).
//
// WHY THIS IS NOT `openDraftPr`. That helper refuses outright when the path already exists on the
// BASE branch — a deliberate, correct safety rule for seeding a STARTER artifact, where overwriting
// a customer's real SECURITY.md would destroy their work. But this lane is the opposite shape: the
// file is ascent's own, ascent is its only author, and the SECOND contribution necessarily finds the
// first one on base. Through `openDraftPr` every contribution after the first would 409 forever.
// So this is a sibling with the create-OR-update semantics that are right here, and
// `src/lib/github/write.ts` is left exactly as it is.
//
// The write is still a PULL REQUEST, never a push to the default branch: the registry belongs to the
// customer and a CODEOWNER merging is the act of accepting the contribution.

import { AppApiError, githubAppFetch } from "@/lib/github/app";
import { encodePathSegments } from "@/lib/github/host";

export interface SignalsPrInput {
  token: string;
  owner: string;
  repo: string;
  /** Base branch; resolved to the repo default when omitted. */
  base?: string;
  path: string;
  content: string;
  commitMessage: string;
  prTitle: string;
  prBody: string;
}

export interface SignalsPrResult {
  url: string;
  number: number;
  branch: string;
  commitSha: string | null;
  /** True when an already-open PR for this head was reused rather than a new one opened. */
  reused: boolean;
  /** True when the file already existed on base and this contribution UPDATES it. */
  updated: boolean;
}

/** One stable branch per contributor, so a repeat contribution updates its own PR instead of
 *  opening a new one every month. */
export const signalsBranch = (contributor: string) => `ascent/registry-signals/${contributor}`;

const enc = (s: string) => Buffer.from(s, "utf8").toString("base64");

async function fileSha(token: string, owner: string, repo: string, path: string, ref: string): Promise<string | null> {
  try {
    const file = await githubAppFetch<{ sha: string }>(
      `/repos/${owner}/${repo}/contents/${encodePathSegments(path)}?ref=${encodeURIComponent(ref)}`,
      token,
    );
    return file.sha ?? null;
  } catch (err) {
    if (err instanceof AppApiError && err.status === 404) return null;
    throw err;
  }
}

export async function openOrUpdateSignalsPr(input: SignalsPrInput): Promise<SignalsPrResult> {
  const { token, owner, repo, path, content, commitMessage, prTitle, prBody } = input;
  const base =
    input.base ?? (await githubAppFetch<{ default_branch: string }>(`/repos/${owner}/${repo}`, token)).default_branch;
  const baseSha = (
    await githubAppFetch<{ object: { sha: string } }>(
      `/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(base)}`,
      token,
    )
  ).object.sha;

  const branch = signalsBranch(path.split("/").pop()!.replace(/\.json$/i, ""));
  try {
    await githubAppFetch(`/repos/${owner}/${repo}/git/refs`, token, {
      method: "POST",
      body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: baseSha }),
    });
  } catch (err) {
    // 422 = the branch is already there from a previous contribution. That is the normal path.
    if (!(err instanceof AppApiError && err.status === 422)) throw err;
  }

  // The sha to update against is the one ON THE BRANCH — which, for a fresh branch cut from base,
  // is base's. Passing base's sha when the branch has since moved is the classic way to get a 409.
  const onBranch = await fileSha(token, owner, repo, path, branch);
  const onBase = onBranch === null ? await fileSha(token, owner, repo, path, base) : null;
  const put = await githubAppFetch<{ commit?: { sha?: string } }>(
    `/repos/${owner}/${repo}/contents/${encodePathSegments(path)}`,
    token,
    {
      method: "PUT",
      body: JSON.stringify({ message: commitMessage, content: enc(content), branch, ...(onBranch ? { sha: onBranch } : {}) }),
    },
  );

  try {
    const pr = await githubAppFetch<{ html_url: string; number: number }>(`/repos/${owner}/${repo}/pulls`, token, {
      method: "POST",
      body: JSON.stringify({ title: prTitle, head: branch, base, body: prBody }),
    });
    return { url: pr.html_url, number: pr.number, branch, commitSha: put.commit?.sha ?? null, reused: false, updated: Boolean(onBranch ?? onBase) };
  } catch (err) {
    if (err instanceof AppApiError && err.status === 422) {
      const open = await githubAppFetch<{ html_url: string; number: number }[]>(
        `/repos/${owner}/${repo}/pulls?head=${encodeURIComponent(`${owner}:${branch}`)}&state=open`,
        token,
      );
      if (open[0]) {
        return {
          url: open[0].html_url,
          number: open[0].number,
          branch,
          commitSha: put.commit?.sha ?? null,
          reused: true,
          updated: Boolean(onBranch ?? onBase),
        };
      }
    }
    throw err;
  }
}
