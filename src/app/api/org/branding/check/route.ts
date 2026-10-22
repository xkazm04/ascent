// POST /api/org/branding/check { org, brandName?, brandColor?, logoUrl?, probeLogo? }
//   -> { branding, rejected, reasons, logo, logoReason, contrast: { onWhite, onDark } }   (owner · Team+)
// branding-1: "what would this save do", answered before anything is written. The gate stack is the
// save's own (POST /api/org/branding): same-origin + owner (requireOrgOwnerPost), the shared public
// org refused, the Team-plan entitlement with a 503 on a plan-read failure. It WRITES NOTHING: no
// branding row, no logo snapshot, no audit row.
//
// Validation is normalizeBranding, the door setOrgBranding persists through, so the check and the save
// cannot drift. The optional logo probe is fetchSafeLogo, the save's own guarded fetch (one rule,
// never a second fetch path), and only a verdict leaves this route: the fetched bytes and data URI are
// never echoed (an owner-supplied URL fetched from inside the app network must not become a proxy).
// Probes are capped per org so the endpoint cannot be driven as a fetch-anything prober.

import { NextResponse } from "next/server";
import { getCreditState, isDbConfigured } from "@/lib/db";
import { fetchSafeLogo, type LogoRejectReason } from "@/lib/net/logo-fetch";
import { normalizeBranding } from "@/lib/branding/normalize";
import { DEFAULT_BRAND_ACCENT } from "@/lib/branding/color";
import { accentContrastOnDark, accentContrastOnWhite } from "@/features/bought/executive/brandingContrast";
import { planAllowsWhiteLabel } from "@/lib/plans";
import { refusePublicOrgAdmin } from "@/lib/authz";
import { requireOrgOwnerPost } from "@/lib/api/orgPost";
import { rateLimitKeyed, tooManyRequests, type RateLimitConfig } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// CLEARS: the form debounces at 600 ms and probes only when the logo URL changed, so a human editing
// a logo sends a handful of probes a minute. 10/min/org admits that with room for corrections; 60/min
// globally bounds the egress any set of orgs can drive. NOT DERIVED: judgement calls, no measured rate.
const BRANDING_PROBE_RATE_LIMIT: RateLimitConfig = {
  name: "branding-probe",
  perIp: 10,
  global: 60,
  windowMs: 60_000,
  basis: "inherited",
};

export type LogoCheck = "ok" | "unreachable" | "rejected" | "unchecked" | "none";

type CheckBody = { brandName?: string; brandColor?: string; logoUrl?: string; probeLogo?: boolean };

export async function POST(request: Request) {
  if (!isDbConfigured()) return NextResponse.json({ error: "Branding requires a database." }, { status: 503 });
  const gate = await requireOrgOwnerPost<CheckBody>(request);
  if (gate instanceof NextResponse) return gate;
  const noPublic = refusePublicOrgAdmin(gate.org);
  if (noPublic) return noPublic;
  const { org, body } = gate;

  let credit;
  try {
    credit = await getCreditState(org);
  } catch {
    return NextResponse.json({ error: "Couldn’t verify your plan right now. Please try again." }, { status: 503 });
  }
  if (!planAllowsWhiteLabel(credit?.plan)) {
    return NextResponse.json({ error: "Briefing branding is a Team-plan feature." }, { status: 403 });
  }

  const str = (v: unknown) => (typeof v === "string" ? v : null);
  const { branding, rejected, reasons } = normalizeBranding({
    brandName: str(body.brandName),
    brandColor: str(body.brandColor),
    logoUrl: str(body.logoUrl),
  });

  let logo: LogoCheck = branding.logoUrl ? "unchecked" : reasons.logoUrl ? "rejected" : "none";
  let logoReason: LogoRejectReason | null = null;
  if (branding.logoUrl && body.probeLogo === true) {
    const rl = rateLimitKeyed(org.toLowerCase(), BRANDING_PROBE_RATE_LIMIT);
    if (!rl.ok) return tooManyRequests(rl);
    const fetched = await fetchSafeLogo(branding.logoUrl);
    logo = fetched.ok ? "ok" : "unreachable";
    logoReason = fetched.ok ? null : fetched.reason;
  }

  const accent = branding.brandColor ?? DEFAULT_BRAND_ACCENT;
  const contrast = { onWhite: accentContrastOnWhite(accent), onDark: accentContrastOnDark(accent) };
  return NextResponse.json({ branding, rejected, reasons, logo, logoReason, contrast });
}
