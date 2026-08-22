// The one org-slug → org-id resolution the loop routes use for their tenancy re-check.
//
// `stop` and `retry` name a run/lane by id after the caller was authorized for an org SLUG. The two
// have to be tied together explicitly, or an owner of org A could stop org B's run by guessing an id.
// It lives in its own module (rather than in loop-runs.ts) so the route imports a tenancy helper by
// name, and the check is visible in the import list of anything that performs it.

import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { getOrgBySlug } from "@/lib/db/org-shared";

/** The org's row id, or null when there is no DB / no such org. Never throws. */
export async function orgIdForSlug(slug: string): Promise<string | null> {
  if (!isDbConfigured()) return null;
  const org = await getOrgBySlug(slug).catch(() => null);
  if (org) return org.id;
  // getOrgBySlug is request-cached; fall through to a direct read so a cache miss on a freshly
  // created org can't read as "no such org" and 404 a legitimate stop.
  const row = await getPrisma()
    .organization.findUnique({ where: { slug }, select: { id: true } })
    .catch(() => null);
  return row?.id ?? null;
}
