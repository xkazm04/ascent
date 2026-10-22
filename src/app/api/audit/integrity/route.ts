// GET /api/audit/integrity?org=<slug>[&action=&actorId=&since=&until=]
// One verdict over the whole FILTERED audit trail, not just the rows a reader has paged to. Walks the
// same rows the CSV export files (walkAuditLog, same filters, same 10000-row cap) and returns counts by
// read-time HMAC verdict plus the tampered entries themselves (at most 50; `tampered` is the true count).
//
// READ-ONLY. Same tenant gate as /api/audit (requireOrgRead), and it never writes: an audit row from a
// read would trip audit-writes.contract.test.ts. A capped walk says so (`truncated`), so a partial
// sweep can never be rendered as a clean trail.

import { NextResponse } from "next/server";
import { isDbConfigured } from "@/lib/db";
import { requireOrgRead } from "@/lib/authz";
import { AUDIT_WALK_MAX_ROWS, auditFiltersFromParams, sweepAuditIntegrity } from "@/lib/db/audit-walk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

export async function GET(request: Request) {
  if (!isDbConfigured()) {
    return NextResponse.json({ error: "Audit log requires a database (Phase 2 feature)." }, { status: 503 });
  }

  const { searchParams } = new URL(request.url);
  const org = searchParams.get("org");
  if (!org) {
    return NextResponse.json({ error: "Missing 'org' query parameter." }, { status: 400 });
  }

  const denied = await requireOrgRead(org);
  if (denied) return denied;

  try {
    // The CSV branch's own filter builder, so the sweep and the export can never filter differently.
    const sweep = await sweepAuditIntegrity(org, auditFiltersFromParams(searchParams), { cap: AUDIT_WALK_MAX_ROWS });
    return NextResponse.json({ ...sweep, cap: AUDIT_WALK_MAX_ROWS }, { headers: NO_STORE });
  } catch (err) {
    console.error("[audit] integrity sweep failed", err);
    return NextResponse.json({ error: "Failed to verify the audit log." }, { status: 500, headers: NO_STORE });
  }
}
