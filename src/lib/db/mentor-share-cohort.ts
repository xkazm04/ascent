// The COHORT door into `MentorShare` (C4, challenge 2026-10-22d developer-0): the consenting care
// shares of one org's members, read for the anonymous org aggregate and for nothing else.
//
// The personal door (`mentor-share.ts`) reads one row by the viewer's own login. This one lists, so it
// is fenced the other way round:
//   - CONSENT IN THE QUERY: only rows whose `orgAggregate` column is true are selected, and each payload
//     is re-checked after validation (`careShareConsents`), so a row whose column and payload disagree
//     reads as NOT consenting. Every share stored before consent existed carries false and stays out;
//     a push without consent sets it false, which withdraws the person from the next aggregate.
//   - MEMBERS ONLY: the login set is the org's Membership -> User.githubLogin, resolved here from the
//     slug. A sharer who is not a member of the org is never read, whatever else they consented to.
//   - NO IDENTITY OUT: the select carries `payloadJson` only. The result is a bag of anonymous payloads;
//     it has no login and no row id.
//   - NEVER PER PERSON: the only caller is `getCareOrgAggregate`, which hands the cohort straight to the
//     floored producer (`care-org-aggregate.ts`). No route exposes this shape.
//   - The shared PUBLIC_ORG funnel is not a workspace; it reads nothing.

import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { normalizeLogin } from "@/lib/db/members";
import { careShareConsents, validateCareShare, type CareSharePayload } from "@/lib/org/care-share-contract";
import { PUBLIC_ORG } from "@/lib/org-constants";

/** The anonymous input to the org care aggregate. Deliberately carries no login and no row identity. */
export interface OrgCareCohort {
  shares: CareSharePayload[];
}

const EMPTY = (): OrgCareCohort => ({ shares: [] });

/** The consenting shares of `orgSlug`'s members, as anonymous payloads. Empty for the public org or no db. */
export async function getOrgCareCohort(orgSlug: string): Promise<OrgCareCohort> {
  if (!orgSlug || orgSlug === PUBLIC_ORG || !isDbConfigured()) return EMPTY();
  const prisma = getPrisma();
  const members = await prisma.membership.findMany({
    where: { org: { slug: orgSlug } },
    select: { user: { select: { githubLogin: true } } },
  });
  const logins = [...new Set(members.map((m) => m.user?.githubLogin).filter((l): l is string => Boolean(l)).map(normalizeLogin))];
  if (logins.length === 0) return EMPTY();

  const rows = await prisma.mentorShare.findMany({
    where: { orgAggregate: true, login: { in: logins } },
    select: { payloadJson: true },
  });
  const shares: CareSharePayload[] = [];
  for (const row of rows) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.payloadJson);
    } catch {
      continue;
    }
    const valid = validateCareShare(parsed);
    if (valid.ok && careShareConsents(valid.share)) shares.push(valid.share);
  }
  return { shares };
}
