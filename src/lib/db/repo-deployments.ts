// One repository's persisted deployments (W4), for the /trends deploy markers.
//
// The org-wide reader (`getDeliveryOutcomes`) aggregates rates over an org the caller has already
// been gated into. This one serves a single repo to /trends, which is reachable for PUBLIC repos
// by any signed-in viewer, so it re-states the history reader's authorization on its own rather
// than leaning on the page having rendered history first:
//
//   • the repo is resolved INSIDE the org the caller passes (`readableOrgForOwner` on the page), by
//     the canonical full name, so a same-named repo in another tenant is never matched;
//   • a PRIVATE repo is refused under the shared public org, exactly as `getRepositoryHistory` and
//     `getScanReportByCommit` refuse it; a failed production deploy is not public information;
//   • the rows are filtered by that repo's id AND its org id, so nothing but this repo's rows can
//     come back even if the denormalized `orgId` ever disagreed with the repo row.
//
// Timestamps leave as ISO strings: these rows end up as chart markers on a client component.

import { dbReadSafe, getPrisma, isDbConfigured } from "@/lib/db/client";
import { canonicalRepoFullName, DEFAULT_ORG_SLUG, resolveOrgId } from "@/lib/db/scans-shared";

/** One stored deployment, as the trend timeline needs it. `sha` is lower-cased at ingest. */
export interface RepoDeployment {
  environment: string;
  sha: string;
  /** The deployment's latest status: success | failure | error | inactive | in_progress | queued | pending. */
  state: string;
  /** ISO timestamp of the deployment's own creation. */
  createdAt: string;
}

/** Upper bound on rows one trends render reads. A marker folds a scan window, so this bounds work,
 *  not what the chart can say; the newest rows win because the query orders newest-first. */
export const REPO_DEPLOYMENT_CAP = 500;

/**
 * Deployments for `owner/name` inside `orgSlug` (default: the shared public org), newest-first.
 *
 * @param since  ISO lower bound on `createdAt` (the oldest scan the chart shows); an unparseable
 *               value is ignored rather than sent as an Invalid Date.
 * @returns `[]` with no DB, an unknown org or repo, a private repo under the public org, or a DB
 *          that is unreachable: absent rows mean no markers, never invented ones.
 */
export async function getRepositoryDeployments(
  owner: string,
  name: string,
  opts: { orgSlug?: string; since?: string | null } = {},
): Promise<RepoDeployment[]> {
  if (!isDbConfigured()) return [];
  return dbReadSafe(async () => {
    const prisma = getPrisma();
    const orgSlug = opts.orgSlug ?? DEFAULT_ORG_SLUG;
    const orgId = await resolveOrgId(orgSlug);
    if (!orgId) return [];
    const repo = await prisma.repository.findUnique({
      where: { orgId_fullName: { orgId, fullName: canonicalRepoFullName(owner, name) } },
      select: { id: true, isPrivate: true },
    });
    if (!repo) return [];
    if (orgSlug === DEFAULT_ORG_SLUG && repo.isPrivate) return [];

    const sinceMs = opts.since ? Date.parse(opts.since) : Number.NaN;
    const rows = await prisma.deployment.findMany({
      where: {
        repoId: repo.id,
        orgId,
        ...(Number.isNaN(sinceMs) ? {} : { createdAt: { gte: new Date(sinceMs) } }),
      },
      orderBy: { createdAt: "desc" },
      take: REPO_DEPLOYMENT_CAP,
      select: { environment: true, sha: true, state: true, createdAt: true },
    });
    return rows.map((r) => ({
      environment: r.environment,
      sha: r.sha,
      state: r.state,
      createdAt: r.createdAt.toISOString(),
    }));
  }, []);
}
