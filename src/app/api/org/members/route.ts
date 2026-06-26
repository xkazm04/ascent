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
import { getMembershipRole, isDbConfigured, listOrgMembers, recordOrgAudit, removeMembership, setMembershipRole } from "@/lib/db";
import { requireOrgRole } from "@/lib/authz";
import { isOrgRole } from "@/lib/db/members";
import { getSession, isSameOrigin } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GitHub logins are 1–39 chars of alphanumerics and single hyphens. Validate the shape so a role can't
// be granted to a garbage/squatted/typo'd string and so the gate, mutation, and audit all agree.
const GITHUB_LOGIN = /^[A-Za-z0-9-]{1,39}$/;

export async function GET(request: Request) {
  if (!isDbConfigured()) return NextResponse.json({ error: "Members require a database." }, { status: 503 });
  const raw = new URL(request.url).searchParams.get("org");
  if (!raw) return NextResponse.json({ error: "Missing ?org." }, { status: 400 });
  // Canonicalize the slug once so the gate, data read, and (in POST/DELETE) the mutation + audit can
  // never disagree on which org the request refers to (case-divergence was a real IDOR/audit risk).
  const org = raw.trim().toLowerCase();
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
  const org = body.org.trim().toLowerCase();
  const login = body.login.trim();
  if (!GITHUB_LOGIN.test(login)) {
    return NextResponse.json({ error: "login must be a valid GitHub login." }, { status: 400 });
  }
  const denied = await requireOrgRole(org, "owner");
  if (denied) return denied;
  // Capture the prior role for the audit trail before the upsert overwrites it.
  const prevRole = await getMembershipRole(org, login).catch(() => null);
  const outcome = await setMembershipRole(org, login, body.role);
  if (outcome === "error") return NextResponse.json({ error: "Unknown organization." }, { status: 404 });
  if (outcome === "db_error") {
    return NextResponse.json({ error: "Couldn't update the role, try again." }, { status: 503 });
  }
  if (outcome === "last_owner") {
    return NextResponse.json({ error: "Can't demote the last owner — assign another owner first." }, { status: 409 });
  }
  const session = await getSession();
  await recordOrgAudit(
    "org.member.role",
    org,
    { org, login: login.toLowerCase(), newRole: body.role, prevRole: prevRole ?? null },
    session?.login,
  );
  return NextResponse.json({ ok: true, login: login.toLowerCase(), role: body.role });
}

export async function DELETE(request: Request) {
  if (!isDbConfigured()) return NextResponse.json({ error: "Members require a database." }, { status: 503 });
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Cross-origin request rejected." }, { status: 403 });
  const { searchParams } = new URL(request.url);
  const org = (searchParams.get("org") ?? "").trim().toLowerCase();
  const login = (searchParams.get("login") ?? "").trim();
  if (!org || !login) return NextResponse.json({ error: "Provide ?org=&login=." }, { status: 400 });
  const denied = await requireOrgRole(org, "owner");
  if (denied) return denied;
  const outcome = await removeMembership(org, login);
  if (outcome === "not_found") return NextResponse.json({ error: "No such member." }, { status: 404 });
  if (outcome === "last_owner") {
    return NextResponse.json({ error: "Can't remove the last owner — assign another owner first." }, { status: 409 });
  }
  const session = await getSession();
  await recordOrgAudit("org.member.removed", org, { org, login: login.toLowerCase() }, session?.login);
  return NextResponse.json({ ok: true });
}
