// The ONE rule for which org a report is read under - shared by the permalink
// (src/app/report/[owner]/[repo]/page.tsx) and the report exports (./export-read.ts), so the PDF,
// briefing and share card a viewer downloads come from the same tenant as the page they are on.

import { readableOrgForOwner } from "@/lib/auth";
import { canReadOrg } from "@/lib/authz";

/** Resolve the org a report is read under. An explicit `?org={slug}` wins when the viewer may read it
 *  - an in-app link from a dashboard whose org SLUG differs from the repo OWNER login (e.g. a rebranded
 *  org) uses it so the report resolves under the owning tenant instead of dead-ending on the owner to
 *  public fallback. Gated by canReadOrg, so the hint can never reach another tenant's private report;
 *  without it (external/shared links), it falls back to owner to readable-org, unchanged. */
export async function resolveReportOrg(owner: string, org: string | string[] | null | undefined): Promise<string> {
  const hint = typeof org === "string" ? org.trim().toLowerCase() : undefined;
  if (hint && (await canReadOrg(hint))) return hint;
  return readableOrgForOwner(owner);
}
