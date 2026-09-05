// GET  /api/org/tokens?org=            -> { tokens }            list active tokens (no raw values)
// POST /api/org/tokens { org, name, scopes? } -> { token, summary }   mint a token (raw shown ONCE)
// Org API tokens let a repo / CLI / CI reach the Skills Library without a browser session. Minting is
// SESSION-only and member-gated (requireOrgAccess) — a token can never mint another token (no privilege
// escalation). The write/telemetry capability a token grants is still enforced downstream by the skill
// routes' own plan/scope gates, so no extra plan gate is needed here (a read token is fine on any plan).

import { NextResponse } from "next/server";
import { createOrgApiToken, isDbConfigured, isSkillTokenScope, listOrgApiTokens, recordOrgAudit, SKILL_TOKEN_SCOPES } from "@/lib/db";
import { requireOrgAccess } from "@/lib/authz";
import { resolveViewerLogin } from "@/lib/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isDbConfigured()) return NextResponse.json({ error: "API tokens require a database." }, { status: 503 });
  const org = new URL(request.url).searchParams.get("org");
  if (!org) return NextResponse.json({ error: "Missing ?org." }, { status: 400 });
  const denied = await requireOrgAccess(org);
  if (denied) return denied;
  return NextResponse.json({ tokens: await listOrgApiTokens(org), scopes: SKILL_TOKEN_SCOPES });
}

export async function POST(request: Request) {
  if (!isDbConfigured()) return NextResponse.json({ error: "API tokens require a database." }, { status: 503 });
  const body = (await request.json().catch(() => ({}))) as { org?: string; name?: string; scopes?: string[] };
  if (!body.org || !body.name?.trim()) {
    return NextResponse.json({ error: "Provide { org, name }." }, { status: 400 });
  }
  const denied = await requireOrgAccess(body.org);
  if (denied) return denied;
  const scopes = Array.isArray(body.scopes) ? body.scopes.filter(isSkillTokenScope) : undefined;
  const actorLogin = await resolveViewerLogin();
  const created = await createOrgApiToken(body.org, { name: body.name, scopes, createdBy: actorLogin });
  if (!created) return NextResponse.json({ error: "Failed to create token." }, { status: 500 });
  await recordOrgAudit("org_api_token.created", body.org, { tokenId: created.summary.id, name: created.summary.name, scopes: created.summary.scopes }, actorLogin ?? undefined);
  return NextResponse.json(created);
}
