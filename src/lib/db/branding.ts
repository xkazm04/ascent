// White-label briefing branding (EXEC-5, enterprise). An org owner sets a brand name, accent colour,
// and logo; the executive-briefing PDF renders them in place of the Ascent defaults. Stored on
// Organization (additive columns). Validated on write (hex colour + https logo) so a bad value can't
// break PDF rendering. No-op / null when persistence is off, like the rest of src/lib/db.

import { getPrisma, isDbConfigured } from "@/lib/db/client";

export interface OrgBranding {
  brandName: string | null;
  brandColor: string | null; // #rrggbb
  logoUrl: string | null; // https image URL
}

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

/** Validate + persist branding. A malformed colour/URL is stored as null rather than rejected, so the
 *  PDF always renders. Returns false when persistence is off / the org is unknown. */
export async function setOrgBranding(orgSlug: string, input: OrgBranding): Promise<boolean> {
  if (!isDbConfigured()) return false;
  const prisma = getPrisma();
  const org = await prisma.organization.findUnique({ where: { slug: orgSlug }, select: { id: true } });
  if (!org) return false;
  const brandName = input.brandName?.trim().slice(0, 80) || null;
  const brandColor = input.brandColor && /^#[0-9a-fA-F]{6}$/.test(input.brandColor.trim()) ? input.brandColor.trim().toLowerCase() : null;
  const logoUrl = input.logoUrl && /^https:\/\/[^\s]+$/i.test(input.logoUrl.trim()) ? input.logoUrl.trim().slice(0, 500) : null;
  await prisma.organization.update({ where: { id: org.id }, data: { brandName, brandColor, logoUrl } });
  return true;
}
