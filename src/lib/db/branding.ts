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

// SSRF guard for the logo URL. The briefing PDF renders `<Image src={logoUrl}>`, which
// @react-pdf fetches SERVER-SIDE from inside the app's network at every render — so an owner-
// supplied URL is an egress vector, not just a rendering-safety concern. The previous check only
// validated the scheme/shape (`^https://[^\s]+$`), so `https://169.254.169.254/...` or
// `https://10.0.0.5:8080/admin` passed and the server would fetch cloud-metadata / internal hosts.
// Accept only https URLs whose host is NOT an IP literal in a private/loopback/link-local/reserved
// range and NOT a known internal hostname. A hostname that RESOLVES to a private IP (DNS rebinding)
// is not caught here — defeating that needs a resolve-and-pin at the fetch site, which @react-pdf
// owns; tracked as a follow-up. This closes the realistic direct-IP / localhost / metadata vectors.
function isSafeLogoUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "https:") return false;
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, ""); // strip IPv6 [..] brackets
  if (!host) return false;
  if (host === "localhost" || host.endsWith(".localhost")) return false;
  if (host.endsWith(".local") || host.endsWith(".internal")) return false;
  if (host === "metadata.google.internal") return false;
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const a = Number(v4[1]);
    const b = Number(v4[2]);
    if ([a, b, Number(v4[3]), Number(v4[4])].some((n) => n > 255)) return false;
    if (a === 0 || a === 10 || a === 127) return false; // this-host, private-A, loopback
    if (a === 169 && b === 254) return false; // link-local + cloud metadata (169.254.169.254)
    if (a === 172 && b >= 16 && b <= 31) return false; // private-B
    if (a === 192 && b === 168) return false; // private-C
    if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT (100.64.0.0/10)
    if (a >= 224) return false; // multicast / reserved
  }
  if (host === "::1" || host === "::") return false; // IPv6 loopback / unspecified
  if (host.startsWith("fc") || host.startsWith("fd")) return false; // IPv6 unique-local fc00::/7
  if (host.startsWith("fe80")) return false; // IPv6 link-local
  return true;
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
  const logoUrl = input.logoUrl && isSafeLogoUrl(input.logoUrl.trim()) ? input.logoUrl.trim().slice(0, 500) : null;
  await prisma.organization.update({ where: { id: org.id }, data: { brandName, brandColor, logoUrl } });
  return true;
}
