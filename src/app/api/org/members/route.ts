// GET    /api/org/members?org=slug             -> { members[] }   list members + roles
// POST   /api/org/members { org, login, role }  -> { ok }         set a member's role
// DELETE /api/org/members?org=slug&login=login  -> { ok }         remove a member (not the last owner)
//
// Owner-only: viewing/assigning/removing roles is an ownership-level action. Roles: owner | admin |
// member | viewer (see src/lib/db/members.ts). This is the management surface that makes RBAC usable —
// an org owner can grant a teammate `viewer` (read-only) or `admin` (destructive ops) without giving
// them the GitHub App installation. Every privilege change is audited (the action that most needs a
// trail). Resolution still treats an installation-owner as owner by default.

import { NextResponse } from "next/server";
import { getMembershipRole, getOrgId, isDbConfigured, listOrgMembers, recordAudit, removeMembership, setMembershipRole } from "@/lib/db";
import { requireOrgRole } from "@/lib/authz";
import { isOrgRole } from "@/lib/db/members";
import { getSession, isSameOrigin } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isDbConfigured()) return NextResponse.json({ error: "Members require a database." }, { status: 503 });
  const org = new URL(request.url).searchParams.get("org");
  if (!org) return NextResponse.json({ error: "Missing ?org." }, { status: 400 });
  const denied = await requireOrgRole(org, "owner");
  if (denied) return denied;
  const members = await listOrgMembers(org);
  return NextResponse.json({ members });
}

export async function POST(request: Request) {
  if (!isDbConfigured()) return NextResponse.json({ error: "Members require a database." }, { status: 503 });
  // CSRF defense-in-depth on this privilege-changing mutation (the session cookie is already SameSite=Lax).
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Cross-origin request rejected." }, { status: 403 });
  const body = (await request.json().catch(() => ({}))) as { org?: string; login?: string; role?: string };
  if (!body.org || !body.login || !body.role || !isOrgRole(body.role)) {
    return NextResponse.json({ error: "Provide { org, login, role: owner|admin|member|viewer }." }, { status: 400 });
  }
  const denied = await requireOrgRole(body.org, "owner");
  if (denied) return denied;
  const login = body.login.trim();
  // Capture the prior role for the audit trail before the upsert overwrites it.
  const prevRole = await getMembershipRole(body.org, login).catch(() => null);
  const outcome = await setMembershipRole(body.org, login, body.role);
  if (outcome === "error") return NextResponse.json({ error: "Unknown organization." }, { status: 404 });
  if (outcome === "last_owner") {
    return NextResponse.json({ error: "Can't demote the last owner — assign another owner first." }, { status: 409 });
  }
  const session = await getSession();
  const orgId = (await getOrgId(body.org.toLowerCase()).catch(() => null)) ?? undefined;
  await recordAudit(
    "org.member.role",
    { org: body.org, login: login.toLowerCase(), newRole: body.role, prevRole: prevRole ?? null },
    { orgId, actorId: session?.login },
  );
  return NextResponse.json({ ok: true, login: login.toLowerCase(), role: body.role });
}

export async function DELETE(request: Request) {
  if (!isDbConfigured()) return NextResponse.json({ error: "Members require a database." }, { status: 503 });
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Cross-origin request rejected." }, { status: 403 });
  const { searchParams } = new URL(request.url);
  const org = searchParams.get("org");
  const login = searchParams.get("login");
  if (!org || !login) return NextResponse.json({ error: "Provide ?org=&login=." }, { status: 400 });
  const denied = await requireOrgRole(org, "owner");
  if (denied) return denied;
  const outcome = await removeMembership(org, login);
  if (outcome === "not_found") return NextResponse.json({ error: "No such member." }, { status: 404 });
  if (outcome === "last_owner") {
    return NextResponse.json({ error: "Can't remove the last owner — assign another owner first." }, { status: 409 });
  }
  const session = await getSession();
  const orgId = (await getOrgId(org.toLowerCase()).catch(() => null)) ?? undefined;
  await recordAudit("org.member.removed", { org, login: login.toLowerCase() }, { orgId, actorId: session?.login });
  return NextResponse.json({ ok: true });
}
