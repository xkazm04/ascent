// The registry repo's READ surface — the only place the indexer touches GitHub.
//
// Everything goes through `githubAppFetch` (the audited App client: one timeout budget, one header
// set, `AppApiError` on non-2xx) rather than a second HTTP client, so a registry read behaves exactly
// like every other installation-token read in the product.
//
// Reads are deliberately CAPPED. A registry is a curated library, not a monorepo: a tree of tens of
// thousands of blobs is a mistake (or an attack), and walking it would blow the request budget. The
// caps are surfaced as warnings by the indexer rather than silently truncating the index.

import { githubAppFetch } from "@/lib/github/app";
import type { PathCommit } from "./trace";
import { encodePathSegments } from "@/lib/github/host";

/** Hard ceiling on indexed files per artifact type. Beyond this the pass reports a warning. */
export const MAX_INDEXED_FILES = 500;
/** Hard ceiling on one file's size (bytes). A larger blob is skipped with a warning. */
export const MAX_FILE_BYTES = 256 * 1024;

export interface RegistryRepoMeta {
  fullName: string;
  defaultBranch: string;
  private: boolean;
  htmlUrl: string;
}

export interface RegistryTreeEntry {
  path: string;
  type: "blob" | "tree";
  size: number;
  sha: string;
}

export interface RegistryTree {
  /** Head COMMIT sha of the ref that was read — the index anchor, not the tree object's sha. */
  headSha: string;
  entries: RegistryTreeEntry[];
  /** GitHub refused to return the whole tree; the index is necessarily partial. */
  truncated: boolean;
}

/** Repo metadata (default branch, visibility). Throws `AppApiError` — 404 means "no such repo / no access". */
export async function getRegistryRepoMeta(token: string, owner: string, repo: string): Promise<RegistryRepoMeta> {
  const r = await githubAppFetch<{
    full_name: string;
    default_branch: string;
    private: boolean;
    html_url: string;
  }>(`/repos/${owner}/${repo}`, token);
  return { fullName: r.full_name, defaultBranch: r.default_branch, private: r.private, htmlUrl: r.html_url };
}

/** Head COMMIT sha of a branch. Distinct from the tree object's sha — this is what `lastIndexSha` stores. */
export async function getHeadSha(token: string, owner: string, repo: string, branch: string): Promise<string> {
  const ref = await githubAppFetch<{ object: { sha: string; type: string } }>(
    `/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(branch)}`,
    token,
  );
  return ref.object.sha;
}

/** Recursive tree at `ref`, plus the head commit sha it resolved to. */
export async function readRegistryTree(
  token: string,
  owner: string,
  repo: string,
  branch: string,
): Promise<RegistryTree> {
  const headSha = await getHeadSha(token, owner, repo, branch);
  const res = await githubAppFetch<{
    tree: { path: string; type: string; size?: number; sha: string }[];
    truncated?: boolean;
  }>(`/repos/${owner}/${repo}/git/trees/${encodePathSegments(headSha)}?recursive=1`, token);

  const entries: RegistryTreeEntry[] = (res.tree ?? []).map((t) => ({
    path: t.path,
    type: t.type === "tree" ? "tree" : "blob",
    size: t.size ?? 0,
    sha: t.sha,
  }));
  return { headSha, entries, truncated: Boolean(res.truncated) };
}

/**
 * One file's UTF-8 content at `ref`, or null when it doesn't exist / isn't a readable blob.
 *
 * Uses the git BLOB endpoint keyed by the tree's own sha rather than the Contents API path lookup:
 * the sha is already in hand from the tree walk, it is immune to path-encoding surprises, and it
 * cannot race a push landing mid-index (the blob is immutable).
 */
export async function readBlob(token: string, owner: string, repo: string, sha: string): Promise<string | null> {
  const b = await githubAppFetch<{ content?: string; encoding?: string }>(
    `/repos/${owner}/${repo}/git/blobs/${encodeURIComponent(sha)}`,
    token,
  );
  if (!b.content) return null;
  if (b.encoding && b.encoding !== "base64") return null;
  return Buffer.from(b.content, "base64").toString("utf8");
}

/**
 * Commits touching one path, newest first (#36).
 *
 * CAPPED, and the cap is disclosed rather than hidden: `perPage` bounds one request and this
 * deliberately does not paginate. A skill file with a thousand commits would otherwise turn one
 * panel open into thirty API calls, and this timeline's value is at its recent end. One extra row is
 * requested purely so `truncated` can be true — a silently short history is indistinguishable from a
 * short one.
 *
 * `authorLogin` is null when GitHub cannot attribute the commit to an account. It is never filled in
 * from the git author NAME, which is an unverified string a committer types.
 */
export async function listPathCommits(
  token: string,
  owner: string,
  repo: string,
  path: string,
  ref: string,
  perPage: number,
): Promise<{ commits: PathCommit[]; truncated: boolean }> {
  const capped = Math.min(100, Math.max(1, perPage));
  const probe = Math.min(100, capped + 1);
  const raw = await githubAppFetch<
    {
      sha: string;
      commit?: { message?: string; author?: { date?: string } };
      author?: { login?: string } | null;
    }[]
  >(
    `/repos/${owner}/${repo}/commits?path=${encodeURIComponent(path)}&sha=${encodeURIComponent(ref)}&per_page=${probe}`,
    token,
  );
  const commits = (raw ?? []).slice(0, capped).map((c) => ({
    sha: c.sha,
    authoredAt: c.commit?.author?.date ?? new Date(0).toISOString(),
    authorLogin: c.author?.login ?? null,
    message: c.commit?.message ?? "",
  }));
  return { commits, truncated: (raw ?? []).length > capped };
}
