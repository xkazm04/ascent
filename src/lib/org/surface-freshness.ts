// The freshness join for the UI surfaces tab: what digest the org's registry index mirror holds for
// each subject, so a showcase authored against `sha256:…` can be badged "current" or "authored
// against an older subject". SERVER only (reads the db); the result is strings-only and crosses to
// the client as a plain record.
//
// Degrades to `{}` on every failure — org unmapped, no db, a read error — and the caller treats an
// empty map as "no badge". A badge that is absent is honest; a badge that guesses is not.

import { getOrgId } from "@/lib/db/org-rollup";
import { listOrgKnowledgeSubjects } from "@/lib/db/org-registry-subjects";

/** The software-engineering bundle is the one that carries the ui-surfaces branch. */
const BUNDLE = "software-engineering";

export type SurfaceFreshness = Record<string, { digest: string | null; status: string | null }>;

/**
 * `{ [subjectSlug]: { digest, status } }` from the org's OrgKnowledgeSubject mirror. `digest` is null
 * when the index pass predates the digest mirror — the badge stays absent rather than wrong.
 */
export async function getSurfaceFreshness(slug: string): Promise<SurfaceFreshness> {
  try {
    const orgId = await getOrgId(slug);
    if (!orgId) return {};
    const rows = await listOrgKnowledgeSubjects(orgId, BUNDLE);
    const out: SurfaceFreshness = {};
    for (const r of rows) out[r.slug] = { digest: r.digest, status: r.status };
    return out;
  } catch {
    return {};
  }
}
