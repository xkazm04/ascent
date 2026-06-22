// POST /api/org/briefing/share { org, range?, from?, to? } -> { token, path, expiresAt }   (owner)
// Mint a signed, expiring read-only share link for the org's executive briefing (EXEC-6). Owner-gated
// + same-origin: only an owner can publish a briefing to someone without an account. The link
// (/share/briefing/[token]) is read-only and re-runs buildExecBriefing for the carried window.

import { NextResponse } from "next/server";
import { requireOrgRole } from "@/lib/authz";
import { isSameOrigin } from "@/lib/auth";
import { briefingShareEnabled, signBriefingShareToken } from "@/lib/briefing-share";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!briefingShareEnabled()) {
    return NextResponse.json({ error: "Briefing sharing isn't configured (set BRIEFING_SHARE_SECRET or AUTH_SECRET)." }, { status: 503 });
  }
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Cross-origin request rejected." }, { status: 403 });
  const body = (await request.json().catch(() => ({}))) as { org?: string; range?: string; from?: string; to?: string; segment?: string; stack?: string };
  if (!body.org) return NextResponse.json({ error: "Provide { org }." }, { status: 400 });
  const denied = await requireOrgRole(body.org, "owner");
  if (denied) return denied;
  // EXEC #1: carry the per-client segment scope + the tech-stack scope (3b) into the signed token so the
  // shared link re-runs identically scoped.
  const minted = signBriefingShareToken({ org: body.org, range: body.range, from: body.from, to: body.to, segment: body.segment, stack: body.stack });
  if (!minted) return NextResponse.json({ error: "Could not mint a share link." }, { status: 503 });
  return NextResponse.json({ token: minted.token, path: `/share/briefing/${minted.token}`, expiresAt: minted.expiresAt });
}
