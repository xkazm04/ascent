// White-label briefing branding (EXEC-5, Team+). An org owner sets a brand name, accent colour,
// and logo; the executive-briefing PDF renders them in place of the Ascent defaults. Stored on
// Organization (additive columns). Validated on write (hex colour + https logo) so a bad value can't
// break PDF rendering. No-op / null when persistence is off, like the rest of src/lib/db.
//
// branding-1: the validation itself lives in normalizeBranding (src/lib/branding/normalize.ts), the
// one door shared with the no-write POST /api/org/branding/check, so the save and the check cannot
// drift. The types are re-exported from here so every existing import keeps working.

import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { normalizeBranding, type NormalizedBranding, type OrgBranding } from "@/lib/branding/normalize";

export type { OrgBranding, RejectedBrandingField, BrandingRejectReason } from "@/lib/branding/normalize";

/** A repo's branding, or null when unset / DB-less. Empty strings normalize to null (cleared). */
export async function getOrgBranding(orgSlug: string): Promise<OrgBranding | null> {
  if (!isDbConfigured()) return null;
  const org = await getPrisma().organization.findUnique({
    where: { slug: orgSlug },
    select: { brandName: true, brandColor: true, logoUrl: true },
  });
  if (!org) return null;
  return { brandName: org.brandName || null, brandColor: org.brandColor || null, logoUrl: org.logoUrl || null };
}

/** What a save persisted: the NORMALIZED values (echo these so the form reflects what really landed),
 *  the non-empty fields dropped to null in `rejected`, and each drop's reason in `reasons`. */
export type SetBrandingResult = NormalizedBranding;

/** Validate + persist branding. A malformed colour/URL is stored as null rather than rejected, so the
 *  PDF always renders. Returns the normalized values actually stored plus the dropped fields, so the
 *  caller can tell the user which inputs were ignored instead of claiming an unconditional success.
 *  Returns null when persistence is off / the org is unknown. */
export async function setOrgBranding(orgSlug: string, input: OrgBranding): Promise<SetBrandingResult | null> {
  if (!isDbConfigured()) return null;
  const prisma = getPrisma();
  const org = await prisma.organization.findUnique({ where: { slug: orgSlug }, select: { id: true } });
  if (!org) return null;
  const normalized = normalizeBranding(input);
  await prisma.organization.update({ where: { id: org.id }, data: normalized.branding });
  return normalized;
}
