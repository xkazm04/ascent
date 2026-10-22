// The ONE validation door for white-label briefing branding (branding-1). setOrgBranding persists
// what this returns, and POST /api/org/branding/check reports it before anything is written, so the
// save and the check cannot drift. Pure: no DB, no fetch. The logo's reachability (does the URL serve
// an image the PDF can render) is a separate, network-bound question answered by fetchSafeLogo.

import { isSafePublicHttpsUrl } from "@/lib/net/ssrf";
import { HEX_COLOR_RE } from "@/lib/branding/color";

export interface OrgBranding {
  brandName: string | null;
  brandColor: string | null; // #rrggbb
  logoUrl: string | null; // https image URL
}

/** A branding field the caller SENT but that failed validation and normalizes to null. brandName is
 *  truncated, never rejected, so it isn't listed here. */
export type RejectedBrandingField = "brandColor" | "logoUrl";

/** Why a field was rejected. The logo reasons split what isSafePublicHttpsUrl decides as one bit. */
export type BrandingRejectReason = "not-https" | "private-host" | "too-long" | "not-hex";

export interface NormalizedBranding {
  /** The values the save would persist. */
  branding: OrgBranding;
  /** Non-empty fields whose value was malformed and dropped to null. */
  rejected: RejectedBrandingField[];
  /** The reason for each entry in `rejected`. */
  reasons: Partial<Record<RejectedBrandingField, BrandingRejectReason>>;
}

/** Brand names are truncated (not rejected) to this many characters. */
export const MAX_BRAND_NAME_LEN = 80;

// Storage bound for logoUrl. Over-long URLs are REJECTED, never sliced: a slice after the SSRF check
// once stored a chopped, no-longer-validated URL. "The stored string is exactly the validated string".
export const MAX_LOGO_URL_LEN = 500;

/** Why a non-empty, trimmed logo URL is refused, or null when it is accepted. */
function logoRejectReason(url: string): BrandingRejectReason | null {
  if (url.length > MAX_LOGO_URL_LEN) return "too-long";
  // SSRF guard: the PDF's logo is fetched server-side from inside the app network, so the URL is an
  // egress vector. isSafePublicHttpsUrl is the authority (shared with the alert-webhook validator);
  // the protocol check below only NAMES which half of it failed.
  if (isSafePublicHttpsUrl(url)) return null;
  try {
    return new URL(url).protocol === "https:" ? "private-host" : "not-https";
  } catch {
    return "not-https";
  }
}

/** Normalize branding input exactly as the save persists it, naming every rejection's reason. An
 *  empty or whitespace value is a deliberate clear, not a rejection. */
export function normalizeBranding(input: Partial<OrgBranding>): NormalizedBranding {
  const brandName = input.brandName?.trim().slice(0, MAX_BRAND_NAME_LEN) || null;
  const rawColor = input.brandColor?.trim() ?? "";
  const brandColor = rawColor && HEX_COLOR_RE.test(rawColor) ? rawColor.toLowerCase() : null;
  const trimmedLogo = input.logoUrl?.trim() ?? "";
  const logoReason = trimmedLogo ? logoRejectReason(trimmedLogo) : null;
  const logoUrl = trimmedLogo && !logoReason ? trimmedLogo : null;

  const rejected: RejectedBrandingField[] = [];
  const reasons: NormalizedBranding["reasons"] = {};
  if (rawColor && !brandColor) {
    rejected.push("brandColor");
    reasons.brandColor = "not-hex";
  }
  if (trimmedLogo && logoReason) {
    rejected.push("logoUrl");
    reasons.logoUrl = logoReason;
  }
  return { branding: { brandName, brandColor, logoUrl }, rejected, reasons };
}
