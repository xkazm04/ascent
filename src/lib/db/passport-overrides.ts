// Owner-set App Readiness Passport overrides (P4) — the fields a scan can't observe (criticality /
// lifecycle / rollback). Stored per repo (Repository.passportOverridesJson) and applied as a READ-TIME
// overlay over the scan-derived passport (getRepoPassport + getOrgRollup), so the stored scan stays
// untouched and a changed override shows immediately without a re-scan. Set is owner-gated at the route.

import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { parsePassportOverrides, type PassportOverrides } from "@/lib/analyze/passport";

/** Read a repo's stored overrides (validated), or null when none/off/unknown. */
export async function getPassportOverrides(orgSlug: string, repoFullName: string): Promise<PassportOverrides | null> {
  if (!isDbConfigured()) return null;
  const prisma = getPrisma();
  const org = await prisma.organization.findUnique({ where: { slug: orgSlug }, select: { id: true } });
  if (!org) return null;
  const repo = await prisma.repository.findUnique({
    where: { orgId_fullName: { orgId: org.id, fullName: repoFullName } },
    select: { passportOverridesJson: true },
  });
  return parsePassportOverrides(repo?.passportOverridesJson);
}

/** Upsert a repo's overrides (validated/sanitized; empty clears them). False if the repo is unknown. */
export async function setPassportOverrides(orgSlug: string, repoFullName: string, overrides: PassportOverrides): Promise<boolean> {
  if (!isDbConfigured()) return false;
  const prisma = getPrisma();
  const org = await prisma.organization.findUnique({ where: { slug: orgSlug }, select: { id: true } });
  if (!org) return false;
  // Sanitize through the same validator the read path uses (drops unknown enums); empty → clear (null).
  const clean = parsePassportOverrides(JSON.stringify(overrides));
  const res = await prisma.repository.updateMany({
    where: { orgId: org.id, fullName: repoFullName },
    data: { passportOverridesJson: clean ? JSON.stringify(clean) : null },
  });
  return res.count > 0;
}
