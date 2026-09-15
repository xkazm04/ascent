// GitLab deployments → the existing `DeploymentRecord` rows.
//
// GitLab's deployment object already carries BOTH the deployment and its status in one payload, so
// this needs one call where the GitHub path needs a list plus a status read each. The row shape is
// unchanged, which is the point: the outcome views (`deployments` rollups) never learn which forge a
// row came from.

import type { DeploymentRecord } from "@/lib/github/deployments";
import { gitlabGetSoft, projectRef, type GitlabFetchOpts } from "@/lib/forge/gitlab/http";

/** How many recent deployments to read — one page, matching the GitHub path's bounded read. */
export const GITLAB_DEPLOYMENT_PAGE_SIZE = 20;

/** The subset of `GET /projects/:id/deployments` this mapper reads. */
export interface GlDeployment {
  id?: number;
  iid?: number;
  status?: string; // created | running | success | failed | canceled | blocked
  created_at?: string;
  updated_at?: string;
  environment?: { name?: string } | null;
  deployable?: {
    commit?: { id?: string } | null;
    ref?: string | null;
  } | null;
  ref?: { name?: string } | null;
  sha?: string;
}

/**
 * PURE mapper. A deployment with no resolvable commit sha is DROPPED rather than emitted with an empty
 * sha: the sha is the join key the outcome views use to tie a deployment to a scored commit, and a row
 * that cannot be joined is noise that would inflate the deployment count without informing anything.
 */
export function mapDeployments(list: GlDeployment[] | null): DeploymentRecord[] {
  if (!list) return [];
  const out: DeploymentRecord[] = [];
  for (const d of list) {
    const sha = d.sha ?? d.deployable?.commit?.id ?? "";
    const createdAt = d.created_at;
    if (!sha || !createdAt) continue;
    out.push({
      externalId: String(d.id ?? d.iid ?? sha),
      environment: d.environment?.name ?? "unknown",
      sha,
      ref: d.deployable?.ref ?? d.ref?.name ?? null,
      // GitLab's vocabulary ("success"/"failed"/"canceled") is passed through unchanged: the outcome
      // views read the string, and translating it into GitHub's ("success"/"failure") would make two
      // forges' rows indistinguishable in a table whose whole job is to be auditable.
      state: d.status ?? "unknown",
      createdAt,
      statusAt: d.updated_at ?? null,
    });
  }
  return out;
}

export async function fetchGitlabDeployments(
  fullPath: string,
  opts: GitlabFetchOpts & { externalId?: string } = {},
): Promise<DeploymentRecord[]> {
  const ref = projectRef(fullPath, opts.externalId);
  const list = await gitlabGetSoft<GlDeployment[]>(
    `/projects/${ref}/deployments?order_by=created_at&sort=desc&per_page=${GITLAB_DEPLOYMENT_PAGE_SIZE}`,
    opts,
  );
  return mapDeployments(list);
}
