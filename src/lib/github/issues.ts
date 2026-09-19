// GitHub issue creation on an installation token — the write primitive behind the "file this as an
// issue" actions (blocker docket, and any future actionable-insight surface). Sibling of write.ts
// (PRs) and checks.ts: one githubAppFetch call, AppApiError on failure so routes can branch on
// status (403 missing issues:write, 404 repo gone, 410 issues disabled on the repo).
//
// IDEMPOTENCY (Direction 7). The docket POSTs one issue per selected repo per click and had no
// memory, so re-opening it after a refresh re-filed the same blocker — the customer repo collected a
// duplicate per visit. The PR writer has never had that shape (fixed branch, create-or-update,
// 422 -> reuse), and checks.ts's sticky comment solves the same problem for PR comments by carrying a
// HIDDEN MARKER in the body and searching for it before writing. This borrows that precedent exactly:
// an issue filed with a `marker` embeds it as an HTML comment (invisible in rendered markdown), and a
// later call with the same marker finds the OPEN issue carrying it and returns it as `reused` instead
// of creating a second one. Paging mirrors upsertStickyComment: forward to the first short page, with
// MAX_PAGES only as a safety ceiling. Deliberately OPEN issues only — a blocker that was filed, fixed
// and closed, then regressed, must be fileable again.

import { githubAppFetch } from "@/lib/github/app";

export interface NewIssue {
  title: string;
  body: string;
  labels?: string[];
  /**
   * Stable dedupe marker, e.g. `<!-- ascent:passport-blocker:auto.self-verify-gaps -->`. When present
   * it is appended to the body on create and searched for on the repo's open issues first. Callers
   * MUST mint this server-side from a validated id — never pass caller-supplied text through.
   */
  marker?: string;
}

export interface CreatedIssue {
  number: number;
  url: string; // html_url — the link a human opens
  /** True when this call found an existing open issue carrying the marker and wrote nothing. */
  reused: boolean;
}

/** Build the hidden dedupe marker for a passport blocker. One place, so writer and reader agree. */
export function passportBlockerMarker(findingId: string): string {
  return `<!-- ascent:passport-blocker:${findingId} -->`;
}

const PER_PAGE = 100;
// Safety ceiling (mirrors upsertStickyComment): 50x100 = 5000 open issues. The loop normally stops far
// earlier at the first short page.
const MAX_PAGES = 50;

/**
 * Find the repo's OPEN issue carrying `marker`, or null. Scans forward to the first short page.
 * `pull_request` rows are skipped: the issues endpoint returns PRs too, and a PR body carrying our
 * marker (the passport PR writer quotes findings) must never be mistaken for the filed issue.
 */
async function findOpenIssueByMarker(
  token: string,
  owner: string,
  repo: string,
  marker: string,
): Promise<CreatedIssue | null> {
  for (let page = 1; page <= MAX_PAGES; page++) {
    const issues = await githubAppFetch<
      { number: number; html_url: string; body: string | null; pull_request?: unknown }[]
    >(`/repos/${owner}/${repo}/issues?state=open&per_page=${PER_PAGE}&page=${page}`, token);
    for (const i of issues) {
      if (i.pull_request) continue;
      if (typeof i.body === "string" && i.body.includes(marker)) {
        return { number: i.number, url: i.html_url, reused: true };
      }
    }
    if (issues.length < PER_PAGE) break;
  }
  return null;
}

export async function createRepoIssue(
  token: string,
  owner: string,
  repo: string,
  issue: NewIssue,
): Promise<CreatedIssue> {
  if (issue.marker) {
    const existing = await findOpenIssueByMarker(token, owner, repo, issue.marker);
    if (existing) return existing;
  }
  const body = issue.marker ? `${issue.body}\n\n${issue.marker}` : issue.body;
  const data = await githubAppFetch<{ number: number; html_url: string }>(
    `/repos/${owner}/${repo}/issues`,
    token,
    {
      method: "POST",
      body: JSON.stringify({
        title: issue.title,
        body,
        ...(issue.labels && issue.labels.length > 0 ? { labels: issue.labels } : {}),
      }),
    },
  );
  return { number: data.number, url: data.html_url, reused: false };
}
