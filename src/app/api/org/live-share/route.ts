// POST /api/org/live-share { org } -> { token, path, expiresAt }   (owner)
// Mint a signed, expiring read-only share link for the org's live war-room (WAR-4). Owner-gated +
// same-origin: only an owner can publish their fleet wall to an unauthenticated screen. The link
// (/live/shared/[token]) is read-only — it can't trigger scans (that path stays session-gated).

import { NextResponse } from "next/server";
import { requireOrgRole } from "@/lib/authz";
import { isSameOrigin } from "@/lib/auth";
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
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Cross-origin request rejected." }, { status: 403 });
  const body = (await request.json().catch(() => ({}))) as { org?: string };
  if (!body.org) return NextResponse.json({ error: "Provide { org }." }, { status: 400 });
  const denied = await requireOrgRole(body.org, "owner");
  if (denied) return denied;
  const minted = signLiveShareToken(body.org);
  if (!minted) return NextResponse.json({ error: "Could not mint a share link." }, { status: 503 });
  return NextResponse.json({ token: minted.token, path: `/live/shared/${minted.token}`, expiresAt: minted.expiresAt });
}
