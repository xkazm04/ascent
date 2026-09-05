// GitHub issue creation on an installation token — the write primitive behind the "file this as an
// issue" actions (blocker docket, and any future actionable-insight surface). Sibling of write.ts
// (PRs) and checks.ts: one githubAppFetch call, AppApiError on failure so routes can branch on
// status (403 missing issues:write, 404 repo gone, 410 issues disabled on the repo).

import { githubAppFetch } from "@/lib/github/app";

export interface NewIssue {
  title: string;
  body: string;
  labels?: string[];
}

export interface CreatedIssue {
  number: number;
  url: string; // html_url — the link a human opens
}

export async function createRepoIssue(
  token: string,
  owner: string,
  repo: string,
  issue: NewIssue,
): Promise<CreatedIssue> {
  const data = await githubAppFetch<{ number: number; html_url: string }>(
    `/repos/${owner}/${repo}/issues`,
    token,
    {
      method: "POST",
      body: JSON.stringify({
        title: issue.title,
        body: issue.body,
        ...(issue.labels && issue.labels.length > 0 ? { labels: issue.labels } : {}),
      }),
    },
  );
  return { number: data.number, url: data.html_url };
}
