// POST /api/org/briefing/share { org, range?, from?, to? } -> { token, path, expiresAt }   (owner)
// Mint a signed, expiring read-only share link for the org's executive briefing (EXEC-6). Owner-gated
// + same-origin: only an owner can publish a briefing to someone without an account. The link
// (/share/briefing/[token]) is read-only and re-runs buildExecBriefing for the carried window.

import { NextResponse } from "next/server";
import { requireOrgOwnerPost } from "@/lib/api/orgPost";
import { authGateEnabled, getViewer } from "@/lib/access";
import { briefingShareEnabled, signBriefingShareToken } from "@/lib/briefing-share";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!briefingShareEnabled()) {
    return NextResponse.json({ error: "Briefing sharing isn't configured (set BRIEFING_SHARE_SECRET or AUTH_SECRET)." }, { status: 503 });
  }
  const gate = await requireOrgOwnerPost<{ range?: string; from?: string; to?: string; segment?: string; stack?: string }>(request);
  if (gate instanceof NextResponse) return gate;
  const { org, body } = gate;
  // briefing-share #5: bind the link to the minting owner so it can be revoked by removing/demoting them
  // (a per-link kill switch the stateless token otherwise lacks). Only under the enforced Supabase wall,
  // where membership is the authoritative, seeded source of truth — other auth modes leave it unset and
  // keep the prior stateless behavior unchanged.
  const mintedBy = authGateEnabled() ? (await getViewer())?.login : undefined;
  // EXEC #1: carry the per-client segment scope + the tech-stack scope (3b) into the signed token so the
  // shared link re-runs identically scoped.
  const minted = signBriefingShareToken({ org, range: body.range, from: body.from, to: body.to, segment: body.segment, stack: body.stack, mintedBy });
  if (!minted) return NextResponse.json({ error: "Could not mint a share link." }, { status: 503 });
  return NextResponse.json({ token: minted.token, path: `/share/briefing/${minted.token}`, expiresAt: minted.expiresAt });
}
