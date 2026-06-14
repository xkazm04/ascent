// GET    /api/org/invites?org=slug                         -> { invites[] }   list pending invites
// POST   /api/org/invites { org, role, email?, githubLogin? } -> { invite }     create an invite
// DELETE /api/org/invites?org=slug&id=inviteId              -> { ok }          revoke a pending invite
//
// Owner-only: inviting/revoking is an ownership-level action (mirrors /api/org/members). An invite
// carries a single-use token returned to the owner so they can share the /invite/[token] link.

import { NextResponse } from "next/server";
import { createInvite, getOrgId, isDbConfigured, listPendingInvites, recordAudit, revokeInvite } from "@/lib/db";
import { requireOrgRole } from "@/lib/authz";
import { isOrgRole } from "@/lib/db/members";
import { getSession, isSameOrigin } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isDbConfigured()) return NextResponse.json({ error: "Invites require a database." }, { status: 503 });
  const org = new URL(request.url).searchParams.get("org");
  if (!org) return NextResponse.json({ error: "Missing ?org." }, { status: 400 });
  const denied = await requireOrgRole(org, "owner");
  if (denied) return denied;
  return NextResponse.json({ invites: await listPendingInvites(org) });
}

export async function POST(request: Request) {
  if (!isDbConfigured()) return NextResponse.json({ error: "Invites require a database." }, { status: 503 });
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Cross-origin request rejected." }, { status: 403 });
  const body = (await request.json().catch(() => ({}))) as { org?: string; role?: string; email?: string; githubLogin?: string };
  if (!body.org || !body.role || !isOrgRole(body.role)) {
    return NextResponse.json({ error: "Provide { org, role: owner|admin|member|viewer }." }, { status: 400 });
  }
  if (!body.email?.trim() && !body.githubLogin?.trim()) {
    return NextResponse.json({ error: "Provide an email or a GitHub login to invite." }, { status: 400 });
  }
  const denied = await requireOrgRole(body.org, "owner");
  if (denied) return denied;
  const session = await getSession();
  const invite = await createInvite(body.org, {
    role: body.role,
    email: body.email,
    githubLogin: body.githubLogin,
    invitedBy: session?.login ?? null,
  });
  if (!invite) return NextResponse.json({ error: "Unknown organization." }, { status: 404 });
  const orgId = (await getOrgId(body.org.toLowerCase()).catch(() => null)) ?? undefined;
  await recordAudit(
    "org.member.invited",
    { org: body.org, role: body.role, target: body.githubLogin?.toLowerCase() ?? body.email ?? null },
    { orgId, actorId: session?.login },
  ).catch(() => {});
  return NextResponse.json({ invite });
}

export async function DELETE(request: Request) {
  if (!isDbConfigured()) return NextResponse.json({ error: "Invites require a database." }, { status: 503 });
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Cross-origin request rejected." }, { status: 403 });
  const { searchParams } = new URL(request.url);
  const org = searchParams.get("org");
  const id = searchParams.get("id");
  if (!org || !id) return NextResponse.json({ error: "Provide ?org=&id=." }, { status: 400 });
  const denied = await requireOrgRole(org, "owner");
  if (denied) return denied;
  const ok = await revokeInvite(org, id);
  if (!ok) return NextResponse.json({ error: "No such pending invite." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
