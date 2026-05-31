// GET /api/audit?org=<slug>[&action=&actorId=&since=&until=&cursor=&limit=]
// Org-scoped audit trail with keyset pagination. Requires DATABASE_URL.
//
// The result is always scoped to the requested org (getAuditLog filters by orgId), so no
// cross-tenant entries can leak. Authorization mirrors the org dashboard it powers: when
// auth is on, viewing a non-public org's trail requires a session; the shared "public"
// org and auth-off/local deployments are open.

import { NextResponse } from "next/server";
import { getAuditLog, isDbConfigured } from "@/lib/db";
import { getSession, isAuthConfigured } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isDbConfigured()) {
    return NextResponse.json(
      { error: "Audit log requires a database (Phase 2 feature)." },
      { status: 503 },
    );
  }

  const { searchParams } = new URL(request.url);
  const org = searchParams.get("org");
  if (!org) {
    return NextResponse.json({ error: "Missing 'org' query parameter." }, { status: 400 });
  }

  if (isAuthConfigured() && org.toLowerCase() !== "public") {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Sign in to view this audit log." }, { status: 401 });
    }
  }

  try {
    const page = await getAuditLog(org, {
      action: searchParams.get("action") ?? undefined,
      actorId: searchParams.get("actorId") ?? undefined,
      since: searchParams.get("since") ?? undefined,
      until: searchParams.get("until") ?? undefined,
      cursor: searchParams.get("cursor"),
      limit: Number(searchParams.get("limit")) || 25,
    });
    return NextResponse.json(page ?? { entries: [], nextCursor: null });
  } catch (err) {
    console.error("[audit] query failed", err);
    return NextResponse.json({ error: "Failed to load audit log." }, { status: 500 });
  }
}
