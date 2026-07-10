// POST /api/org/live-share { org } -> { token, path, expiresAt }   (owner)
// Mint a signed, expiring read-only share link for the org's live war-room (WAR-4). Owner-gated +
// same-origin: only an owner can publish their fleet wall to an unauthenticated screen. The link
// (/live/shared/[token]) is read-only — it can't trigger scans (that path stays session-gated).

import { NextResponse } from "next/server";
import { requireOrgOwnerPost } from "@/lib/api/orgPost";
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
  const gate = await requireOrgOwnerPost(request);
  if (gate instanceof NextResponse) return gate;
  const minted = signLiveShareToken(gate.org);
  if (!minted) return NextResponse.json({ error: "Could not mint a share link." }, { status: 503 });
  return NextResponse.json({ token: minted.token, path: `/live/shared/${minted.token}`, expiresAt: minted.expiresAt });
}
