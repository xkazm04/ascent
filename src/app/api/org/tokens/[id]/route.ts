// DELETE /api/org/tokens/:id?org=   -> { ok }   soft-revoke an org API token (session, member-gated)
// The revoke is scoped to ?org (requireOrgAccess + the org filter inside revokeOrgApiToken), so one org
// can neither see nor revoke another's tokens. Soft-revoke: the row survives for the audit trail but
// fails verification immediately.

import { NextResponse } from "next/server";
import { isDbConfigured, recordOrgAudit, revokeOrgApiToken } from "@/lib/db";
import { requireOrgAccess } from "@/lib/authz";
import { resolveViewerLogin } from "@/lib/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(request: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!isDbConfigured()) return NextResponse.json({ error: "API tokens require a database." }, { status: 503 });
  const { id } = await ctx.params;
  const org = new URL(request.url).searchParams.get("org");
  if (!org) return NextResponse.json({ error: "Missing ?org." }, { status: 400 });
  const denied = await requireOrgAccess(org);
  if (denied) return denied;
  const ok = await revokeOrgApiToken(org, id);
  if (!ok) return NextResponse.json({ error: "Token not found." }, { status: 404 });
  const actorLogin = await resolveViewerLogin();
  await recordOrgAudit("org_api_token.revoked", org, { tokenId: id }, actorLogin ?? undefined);
  return NextResponse.json({ ok: true });
}
