// GitLab merge requests → the existing `PrNode` shape → the existing summarizer.
//
// THE DESIGN DECISION THAT MATTERS: this file maps MRs onto `PrNode` and then calls
// `summarizePullRequests` / `extractAiChanges` — the SAME pure functions the GitHub path calls. Not a
// GitLab summarizer. Not a GitLab-flavoured `PrStats`. The AI-involvement detectors, the revert
// linkage, the sample floors and every rate definition therefore come from one implementation, so a
// GitLab repo and a GitHub repo are scored by literally the same code and a rubric change cannot
// reach one forge and miss the other.
//
// It also means this adapter can never move a score by mapping creatively: the only lever it has is
// what it puts in a `PrNode`, and each field's provenance is stated below.
//
// GraphQL, not REST, because GitLab's REST MR list omits diff stats entirely. Reading additions and
// deletions as `0` — the shape a REST mapping would produce — is not a missing value, it is a WRONG
// one: it would make every MR "small" and hand a GitLab repo an unearned `smallPrRate` of 100%. The
// GraphQL `diffStatsSummary` is the only bounded read that answers honestly, so an unavailable
// GraphQL endpoint degrades the whole enrichment to null ("not observable"), never to zeros.

import { summarizePullRequests, extractAiChanges, type AiChangeRecord } from "@/lib/analyze/pulls";
import type { PrNode, PrReview } from "@/lib/github/graphql";
import type { PrStats } from "@/lib/types";
import { fetchWithTimeout } from "@/lib/github/host";
import {
  GITLAB_TIMEOUT_API_MS,
  gitlabApiBase,
  gitlabHeaders,
  type GitlabFetchOpts,
} from "@/lib/forge/gitlab/http";

/** MRs read per scan — the same window the GitHub path uses (`fetchPrStats`'s `limit = 40`), so the
 *  two forges' rates are computed over comparably-sized samples. */
export const GITLAB_MR_LIMIT = 40;

export interface GlMrNode {
  iid?: string | number;
  title?: string;
  description?: string | null;
  draft?: boolean;
  state?: string; // opened | closed | merged | locked
  createdAt?: string;
  mergedAt?: string | null;
  closedAt?: string | null;
  userNotesCount?: number;
  diffStatsSummary?: { additions?: number; deletions?: number; fileCount?: number } | null;
  author?: { username?: string; bot?: boolean } | null;
  labels?: { nodes?: ({ title?: string } | null)[] } | null;
  approvedBy?: { nodes?: ({ username?: string; bot?: boolean } | null)[] } | null;
  mergeCommitSha?: string | null;
  commits?: { nodes?: ({ sha?: string; message?: string } | null)[] } | null;
}

export interface GlMrPage {
  count: number;
  nodes: GlMrNode[];
}

/** GitLab MR state → the GitHub PR state vocabulary the summarizer switches on. `locked` is an open MR
 *  with discussion frozen, so it maps to OPEN; anything unrecognized maps to CLOSED (the conservative
 *  reading — it is never counted as a merge). */
export function mapState(state: string | undefined, mergedAt: string | null | undefined): PrNode["state"] {
  if (mergedAt) return "MERGED";
  if (state === "merged") return "MERGED";
  if (state === "opened" || state === "locked") return "OPEN";
  return "CLOSED";
}

/**
 * PURE mapper: one GitLab MR → one `PrNode`. Provenance, field by field:
 *
 *  - `reviews`      — GitLab's approvals. Each approver becomes one `APPROVED` review with a NULL
 *                     `submittedAt`, because GitLab's approval record carries no timestamp. Null is
 *                     the honest value and the summarizer already handles it: it is what makes
 *                     `medianHoursToFirstReview` come back null for a GitLab repo rather than a
 *                     number invented from the merge time.
 *  - `comments`     — `userNotesCount` (GitLab's user-authored notes; system notes are excluded by
 *                     the API, matching GitHub's comment count).
 *  - `mergeCommit`  — the merge commit's sha + the MR title as its message. GitLab does not return the
 *                     merge commit's MESSAGE on the MR, and the merge commit's message on a default
 *                     GitLab merge IS derived from the MR title — so this carries the title rather
 *                     than nothing, and the per-commit messages below carry the real trailers.
 *  - `commits`      — the MR's last commits, which is where AI attribution trailers actually live.
 */
export function mapMergeRequest(mr: GlMrNode): PrNode | null {
  const number = Number(mr.iid);
  if (!Number.isFinite(number)) return null;
  const createdAt = mr.createdAt;
  if (!createdAt) return null;
  const mergedAt = mr.mergedAt ?? null;

  const reviews: PrReview[] = (mr.approvedBy?.nodes ?? [])
    .filter((n): n is { username?: string; bot?: boolean } => Boolean(n))
    .map((n) => ({
      state: "APPROVED",
      submittedAt: null,
      author: n.username ? { login: n.username, __typename: n.bot ? "Bot" : "User" } : null,
    }));

  const mergeSha = mr.mergeCommitSha ?? undefined;
  return {
    number,
    title: mr.title ?? "",
    bodyText: mr.description ?? "",
    isDraft: mr.draft === true,
    state: mapState(mr.state, mergedAt),
    createdAt,
    mergedAt,
    closedAt: mr.closedAt ?? null,
    additions: nonNegative(mr.diffStatsSummary?.additions),
    deletions: nonNegative(mr.diffStatsSummary?.deletions),
    changedFiles: nonNegative(mr.diffStatsSummary?.fileCount),
    author: mr.author?.username
      ? { login: mr.author.username, __typename: mr.author.bot ? "Bot" : "User" }
      : null,
    labels: {
      nodes: (mr.labels?.nodes ?? [])
        .map((l) => l?.title)
        .filter((t): t is string => typeof t === "string")
        .map((name) => ({ name })),
    },
    reviews: { totalCount: reviews.length, nodes: reviews },
    comments: { totalCount: nonNegative(mr.userNotesCount) },
    ...(mergedAt
      ? { mergeCommit: { ...(mergeSha ? { oid: mergeSha } : {}), message: mr.title ?? "" } }
      : { mergeCommit: null }),
    commits: {
      nodes: (mr.commits?.nodes ?? [])
        .filter((c): c is { sha?: string; message?: string } => Boolean(c))
        .map((c) => ({ commit: { ...(c.sha ? { oid: c.sha } : {}), message: c.message ?? "" } })),
    },
  };
}

function nonNegative(n: number | undefined): number {
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
}

/** PURE: a GraphQL MR page → the SAME `{stats, partial, aiChanges}` triple `fetchPrStats` returns. */
export function summarizeGitlabMrs(page: GlMrPage): {
  stats: PrStats;
  partial: boolean;
  aiChanges: AiChangeRecord[];
} {
  const nodes = page.nodes.map(mapMergeRequest).filter((n): n is PrNode => n != null);
  return {
    stats: summarizePullRequests(nodes, page.count),
    // A dropped node (malformed iid / no createdAt) means the sample is a silently-incomplete slice —
    // exactly what `partial` means on the GitHub path, so it is reported the same way and the scan is
    // not persisted as authoritative.
    partial: nodes.length !== page.nodes.length,
    aiChanges: extractAiChanges(nodes),
  };
}

const MR_QUERY = `query AscentMrs($fullPath: ID!, $n: Int!) {
  project(fullPath: $fullPath) {
    mergeRequests(first: $n, sort: UPDATED_DESC) {
      count
      nodes {
        iid title description draft state createdAt mergedAt closedAt
        userNotesCount mergeCommitSha
        diffStatsSummary { additions deletions fileCount }
        author { username bot }
        labels { nodes { title } }
        approvedBy { nodes { username bot } }
        commits(last: 15) { nodes { sha message } }
      }
    }
  }
}`;

/** GitLab's GraphQL endpoint sits beside the v4 REST root, not under it. */
export function gitlabGraphqlUrl(apiBase: string): string {
  return `${apiBase.replace(/\/api\/v4\/?$/, "")}/api/graphql`;
}

/**
 * Read the MR window and summarize it. Returns null — "not observable" — when the endpoint is
 * unreachable, unauthorized, or answers without a project. Never returns zeroed stats.
 */
export async function fetchGitlabPrStats(
  fullPath: string,
  opts: GitlabFetchOpts & { limit?: number } = {},
): Promise<{ stats: PrStats; partial: boolean; aiChanges: AiChangeRecord[] } | null> {
  const url = gitlabGraphqlUrl(gitlabApiBase(opts.host));
  try {
    const res = await fetchWithTimeout(
      url,
      {
        method: "POST",
        headers: { ...gitlabHeaders(opts.token), "Content-Type": "application/json" },
        body: JSON.stringify({
          query: MR_QUERY,
          variables: { fullPath, n: opts.limit ?? GITLAB_MR_LIMIT },
        }),
        cache: "no-store",
      },
      opts.timeoutMs ?? GITLAB_TIMEOUT_API_MS,
      opts.signal,
    );
    if (!res.ok) return null;
    const body = (await res.json()) as {
      data?: { project?: { mergeRequests?: { count?: number; nodes?: (GlMrNode | null)[] } } | null };
    };
    const conn = body.data?.project?.mergeRequests;
    if (!conn) return null;
    const nodes = (conn.nodes ?? []).filter((n): n is GlMrNode => Boolean(n));
    return summarizeGitlabMrs({ count: Math.max(0, Math.trunc(conn.count ?? nodes.length)), nodes });
  } catch {
    return null;
  }
}
