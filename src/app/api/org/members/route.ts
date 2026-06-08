// GET  /api/org/members?org=slug         -> { members[] }   list members + roles
// POST /api/org/members { org, login, role } -> { ok }        set a member's role
//
// Owner-only: viewing/assigning roles is an ownership-level action. Roles: owner | admin | member |
// viewer (see src/lib/db/members.ts). This is the management surface that makes RBAC usable — an org
// owner can grant a teammate `viewer` (read-only) or `admin` (destructive ops) without giving them the
// GitHub App installation. Resolution still treats an installation-owner as owner by default.

import { NextResponse } from "next/server";
import { isDbConfigured, listOrgMembers, setMembershipRole } from "@/lib/db";
import { requireOrgRole } from "@/lib/authz";
import { isOrgRole } from "@/lib/db/members";

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
  const body = (await request.json().catch(() => ({}))) as { org?: string; login?: string; role?: string };
  if (!body.org || !body.login || !body.role || !isOrgRole(body.role)) {
    return NextResponse.json({ error: "Provide { org, login, role: owner|admin|member|viewer }." }, { status: 400 });
  }
  const denied = await requireOrgRole(body.org, "owner");
  if (denied) return denied;
  const ok = await setMembershipRole(body.org, body.login, body.role);
  if (!ok) return NextResponse.json({ error: "Unknown organization." }, { status: 404 });
  return NextResponse.json({ ok: true, login: body.login.toLowerCase(), role: body.role });
}
