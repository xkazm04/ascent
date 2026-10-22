// POST /api/org/branding { org, brandName?, brandColor?, logoUrl? } -> { ok, branding, rejected, logoUnreachable, logoReason }   (owner · Team+)
// Set white-label branding for the executive-briefing PDF (EXEC-5). Owner-gated + same-origin, and
// gated to the Team-and-up entitlement tier. Values are validated/normalized in setOrgBranding
// (hex colour + https logo, else stored null) so a bad input can't break PDF rendering. A successful
// write is audited as `org.branding.updated` with the normalized values that actually landed.

import { NextResponse } from "next/server";
import { getCreditState, isDbConfigured, recordOrgAudit, setOrgBranding } from "@/lib/db";
import { resolveViewerLogin } from "@/lib/access";
import { fetchSafeLogo } from "@/lib/net/logo-fetch";
import { setOrgLogoSnapshot } from "@/lib/db/org-logo-snapshot";
import { planAllowsWhiteLabel } from "@/lib/plans";
import { refusePublicOrgAdmin } from "@/lib/authz";
import { requireOrgOwnerPost } from "@/lib/api/orgPost";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Compact line the audit viewer renders in `meta.status` for a branding write. */
function brandingAuditStatus(
  branding: { brandName: string | null; brandColor: string | null; logoUrl: string | null },
  rejected: string[],
): string {
  const bits = [branding.brandName, branding.brandColor, branding.logoUrl ? "logo" : null].filter(
    (b): b is string => Boolean(b),
  );
  const core = bits.join(" · ") || "cleared";
  return rejected.length ? `${core} (dropped ${rejected.join(", ")})` : core;
}

export async function POST(request: Request) {
  if (!isDbConfigured()) return NextResponse.json({ error: "Branding requires a database." }, { status: 503 });
  const gate = await requireOrgOwnerPost<{ brandName?: string; brandColor?: string; logoUrl?: string }>(request);
  if (gate instanceof NextResponse) return gate;
  const noPublic = refusePublicOrgAdmin(gate.org);
  if (noPublic) return noPublic;
  const { org, body } = gate;

  // Entitlement: briefing white-label is a Team-and-up feature (so a reseller on Team can brand the
  // reports they hand to clients), not Enterprise-only. Distinguish "couldn't determine the plan"
  // (a transient DB hiccup) from "genuinely not entitled": folding a read error into `null` mapped a
  // legitimate Team/Enterprise owner to a misleading 403 "you don't have this plan" during an outage,
  // so a read failure returns a retryable 503 instead.
  let credit;
  try {
    credit = await getCreditState(org);
  } catch {
    return NextResponse.json({ error: "Couldn’t verify your plan right now. Please try again." }, { status: 503 });
  }
  if (!planAllowsWhiteLabel(credit?.plan)) {
    return NextResponse.json({ error: "Briefing branding is a Team-plan feature." }, { status: 403 });
  }

  // Echo the NORMALIZED values actually stored so the client can warn about anything the validator
  // discarded (a non-https/private logo → null) or truncated (an >80-char name) instead of showing
  // unconditional success while the value was silently dropped.
  const stored = await setOrgBranding(org, {
    brandName: body.brandName ?? null,
    brandColor: body.brandColor ?? null,
    logoUrl: body.logoUrl ?? null,
  });
  if (!stored) return NextResponse.json({ error: "Unknown organization." }, { status: 404 });
  // After the write: a denied/failed POST must not leave a trail row. resolveViewerLogin (not the
  // dormant custom-OAuth session) is the live actor under the Supabase wall. recordOrgAudit swallows
  // its own failures; the extra catch keeps an audit hiccup from withholding the save.
  const actorLogin = await resolveViewerLogin();
  await recordOrgAudit(
    "org.branding.updated",
    org,
    {
      org,
      status: brandingAuditStatus(stored.branding, stored.rejected),
      brandName: stored.branding.brandName,
      brandColor: stored.branding.brandColor,
      logoUrl: stored.branding.logoUrl,
      rejected: stored.rejected,
    },
    actorLogin ?? undefined,
  ).catch(() => {});
  // branding-0: the save-time fetch IS the logo snapshot. ONE pinned, magic-byte-sniffed fetch
  // (fetchSafeLogo: resolve once, connect to that address, PNG/JPEG/SVG only, 512 KB cap) and the
  // result is stored; the PDF and the share page render the stored data URI, so nothing fetches the
  // owner's host at render time. Validation only proved the URL is SAFE, not that it serves a logo the
  // PDF can render, so a WebP / HTML page / unreachable asset is reported (logoUnreachable + the
  // reason) instead of a green "Saved" over a logo-less deliverable. Advisory only: the URL stays
  // saved and no snapshot is stored for it. A snapshot write failure never withholds the save; the
  // deliverable heals on its next render.
  let logoUnreachable = false;
  let logoReason: string | null = null;
  const logoUrl = stored.branding.logoUrl;
  if (logoUrl) {
    const logo = await fetchSafeLogo(logoUrl);
    if (logo.ok) {
      await setOrgLogoSnapshot(org, { sourceUrl: logoUrl, sha256: logo.sha256, mime: logo.mime, dataUri: logo.dataUri }).catch(
        (err: unknown) => console.warn("[org/branding] logo snapshot write failed", err instanceof Error ? err.message : err),
      );
    } else {
      logoUnreachable = true;
      logoReason = logo.reason;
    }
  }
  // setOrgBranding returns { branding, rejected }; unwrap so the client gets the FLAT normalized
  // OrgBranding it reads (d.branding.brandName/…) plus the list of dropped fields to warn about —
  // passing `stored` whole would nest it under branding and blank every field client-side.
  return NextResponse.json({ ok: true, branding: stored.branding, rejected: stored.rejected, logoUnreachable, logoReason });
}
