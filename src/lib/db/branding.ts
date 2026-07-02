// White-label briefing branding (EXEC-5, Team+). An org owner sets a brand name, accent colour,
// and logo; the executive-briefing PDF renders them in place of the Ascent defaults. Stored on
// Organization (additive columns). Validated on write (hex colour + https logo) so a bad value can't
// break PDF rendering. No-op / null when persistence is off, like the rest of src/lib/db.

import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { isSafePublicHttpsUrl } from "@/lib/net/ssrf";
import { HEX_COLOR_RE } from "@/lib/branding/color";

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

// SSRF guard for the logo URL. The briefing PDF renders `<Image src={logoUrl}>`, which @react-pdf
// fetches SERVER-SIDE from inside the app's network at every render — so an owner-supplied URL is an
// egress vector, not just a rendering-safety concern. Delegates to the shared isSafePublicHttpsUrl
// (https-only + reject loopback/private/CGNAT/link-local/unique-local/multicast/internal-hostname),
// the same guard the alert-webhook validator uses, so the two can no longer drift. A hostname that
// RESOLVES to a private IP (DNS rebinding) is not caught here — that needs a resolve-and-pin at the
// fetch site, which @react-pdf owns; tracked as a follow-up.
function isSafeLogoUrl(raw: string): boolean {
  return isSafePublicHttpsUrl(raw);
}

/** A branding field the caller SENT but that failed validation and was stored as null. Lets the API
 *  route / settings form warn "logo URL ignored — must be an https image URL" instead of a blanket
 *  "saved" that hides the drop. (brandName is truncated, never rejected, so it isn't listed here.) */
export type RejectedBrandingField = "brandColor" | "logoUrl";

export interface SetBrandingResult {
  /** The values actually persisted after normalization — echo these so the form reflects what really
   *  landed rather than what was submitted. */
  branding: OrgBranding;
  /** Non-empty fields whose value was malformed and dropped to null (bad hex / unsafe-or-non-https
   *  logo URL). Empty → everything the caller sent was applied verbatim. */
  rejected: RejectedBrandingField[];
}

/** Validate + persist branding. A malformed colour/URL is stored as null rather than rejected, so the
 *  PDF always renders — but the dropped fields are reported in `rejected` so the caller can tell the
 *  user which inputs were ignored instead of claiming an unconditional success. Returns null when
 *  persistence is off / the org is unknown. */
export async function setOrgBranding(orgSlug: string, input: OrgBranding): Promise<SetBrandingResult | null> {
  if (!isDbConfigured()) return null;
  const prisma = getPrisma();
  const org = await prisma.organization.findUnique({ where: { slug: orgSlug }, select: { id: true } });
  if (!org) return null;
  const brandName = input.brandName?.trim().slice(0, 80) || null;
  const brandColor = input.brandColor && HEX_COLOR_RE.test(input.brandColor.trim()) ? input.brandColor.trim().toLowerCase() : null;
  const logoUrl = input.logoUrl && isSafeLogoUrl(input.logoUrl.trim()) ? input.logoUrl.trim().slice(0, 500) : null;
  // A field the caller actually filled in but that normalized away to null was REJECTED (bad hex, or a
  // non-https / unsafe logo URL). An empty/whitespace value is a deliberate clear, not a rejection.
  const rejected: RejectedBrandingField[] = [];
  if (input.brandColor?.trim() && !brandColor) rejected.push("brandColor");
  if (input.logoUrl?.trim() && !logoUrl) rejected.push("logoUrl");
  await prisma.organization.update({ where: { id: org.id }, data: { brandName, brandColor, logoUrl } });
  return { branding: { brandName, brandColor, logoUrl }, rejected };
}
