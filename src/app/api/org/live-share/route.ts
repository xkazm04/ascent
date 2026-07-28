// POST /api/org/live-share { org } -> { token, path, expiresAt }   (owner)
// Mint a signed, expiring, revocable read-only share link for the org's live war-room (WAR-4). Owner-gated
// + same-origin: only an owner can publish their fleet wall to an unauthenticated screen. The link
// (/live/shared/[token]) is read-only — it can't trigger scans (that path stays session-gated).

import { NextResponse } from "next/server";
import { requireOrgRole, canReadOrg } from "@/lib/authz";
import { requireSameOrigin } from "@/lib/auth";
import { authGateEnabled, getViewer } from "@/lib/access";
import { liveShareEnabled, signLiveShareToken } from "@/lib/live-share";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!liveShareEnabled()) {
    return NextResponse.json(
      { error: "Live sharing isn't configured (set LIVE_SHARE_SECRET or AUTH_SECRET)." },
      { status: 503 },
    );
  }
  const crossOrigin = requireSameOrigin(request);
  if (crossOrigin) return crossOrigin;
  const body = (await request.json().catch(() => ({}))) as { org?: string };
  if (!body.org) return NextResponse.json({ error: "Provide { org }." }, { status: 400 });
  // live-war-room #2: the mint gate must be AT LEAST AS STRICT as the READ gate, and fail closed.
  // requireOrgRole is OPEN in an auth-off deployment — its owner check is unreachable when
  // !isAuthConfigured() (authz.ts returns null before it) — but the sibling read path canReadOrg stays
  // CLOSED in that same config (→ openOrgDashboardsEnabled(), default false; the hardening added so a
  // dropped AUTH_SECRET can't turn every org public). Without this pre-gate an auth-off box would hand out
  // a public link to a private fleet it refuses to SERVE. canReadOrg encapsulates every mode (Supabase
  // wall / dormant OAuth / auth-off), so requiring it first closes the mint hole and is a safe redundancy
  // under the stronger owner gate below.
  if (!(await canReadOrg(body.org))) {
    return NextResponse.json({ error: "You don't have access to this organization." }, { status: 403 });
  }
  const denied = await requireOrgRole(body.org, "owner");
  if (denied) return denied;
  // Bind the link to the minting owner (owner-binding revocation, like briefing-share EXEC #5) so the
  // shared page honors it only while they keep owner access — removing/demoting them kills their links.
  // Set only under the enforced Supabase wall, the authoritative membership source; other modes leave it
  // unset and keep the prior unbound behavior.
  const mintedBy = authGateEnabled() ? (await getViewer())?.login : undefined;
  const minted = signLiveShareToken(body.org, { mintedBy });
  if (!minted) return NextResponse.json({ error: "Could not mint a share link." }, { status: 503 });
  return NextResponse.json({ token: minted.token, path: `/live/shared/${minted.token}`, expiresAt: minted.expiresAt });
}
