// GET /api/audit?org=<slug>[&action=&actorId=&since=&until=&cursor=&limit=][&format=csv]
// Org-scoped audit trail with keyset pagination. Requires DATABASE_URL. `format=csv` streams ALL
// matching rows (walkAuditLog, capped) as a download for compliance evidence.
//
// The result is always scoped to the requested org (getAuditLog filters by orgId), so no
// cross-tenant entries can leak. Authorization mirrors the org dashboard it powers: when
// auth is on, viewing a non-public org's trail requires a session; the shared "public"
// org and auth-off/local deployments are open.

import { NextResponse } from "next/server";
import { getAuditLog, isDbConfigured } from "@/lib/db";
import { sha256Hex } from "@/lib/db/audit-integrity";
import { requireOrgRead } from "@/lib/authz";
import { csvField } from "@/lib/export/csv";
import { AUDIT_WALK_MAX_ROWS, auditFiltersFromParams, walkAuditLog, type AuditWalkFilters } from "@/lib/db/audit-walk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// `orgId` is included because it's one of the fields the per-row HMAC `_sig` (meta cell) is computed
// over — omitting it (as this export used to) made the stated row-level tamper-evidence unverifiable
// from the file alone, since the canonical signed input couldn't be reconstructed (the filename carries
// only the org slug, not the DB orgId).
// `integrity` is the per-row HMAC verdict recomputed at read time (ok / tampered / unsigned / no-secret).
// Without it the file carried the signature but never the CHECK, so an examiner had to re-implement the
// canonical serialization to learn anything from it — and an `unsigned` row was indistinguishable from a
// verified one. Stating the verdict per row is what makes the export self-describing rather than merely
// self-hashing.
const CSV_COLUMNS = ["at", "action", "actorId", "orgId", "repo", "level", "overall", "headSha", "integrity", "meta"] as const;
// Safety cap so one export can't loop the whole table unbounded. It is the walk's cap, shared with the
// integrity sweep (/api/audit/integrity), so both cover the same rows.
const CSV_MAX_ROWS = AUDIT_WALK_MAX_ROWS;

/** Stream the full filtered audit trail as a CSV download (walkAuditLog over getAuditLog pages). */
async function exportCsv(org: string, filters: AuditWalkFilters): Promise<Response> {
  const lines = [CSV_COLUMNS.join(",")];
  const { scanned: total, truncated } = await walkAuditLog(org, filters, {
    cap: CSV_MAX_ROWS,
    visit: (e) => {
      lines.push(
        [
          e.at,
          e.action,
          e.actorId,
          e.orgId,
          e.scan?.repo,
          e.scan?.level,
          e.scan?.overall,
          e.scan?.headSha,
          e.integrity,
          JSON.stringify(e.meta),
        ]
          .map((v) => csvField(v, true)) // audit trail quotes every field uniformly
          .join(","),
      );
    },
  });

  // TRUNCATION HONESTY: the loop also exits at CSV_MAX_ROWS (newest-first, so the OLDEST evidence is
  // dropped); walkAuditLog reports that as `truncated` (a cursor still set). The SHA below signs
  // whatever bytes we emit, so a truncated file would otherwise be filed as complete compliance evidence
  // with a valid integrity hash: false confidence. A still-set cursor means more rows remained, so flag
  // it explicitly (header + a -PARTIAL filename) and tell the operator to narrow the filters to export the rest. The integrity hash still certifies the bytes delivered.
  if (truncated) {
    console.warn(`[audit] csv export for "${org}" truncated at ${CSV_MAX_ROWS} rows — older entries omitted`);
  }
  const stamp = new Date().toISOString().slice(0, 10);
  const body = lines.join("\n") + "\n";
  return new Response(body, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="ascent-audit-${org}-${stamp}${truncated ? "-PARTIAL" : ""}.csv"`,
      "cache-control": "no-store",
      // File-level integrity for the filed evidence (recompute SHA-256 over the bytes to verify). Each
      // row also carries its own HMAC `_sig` in the meta cell, so individual rows are tamper-evident too.
      "x-ascent-content-sha256": sha256Hex(body),
      // Make completeness explicit so a capped export can't be mistaken for the full trail.
      "x-ascent-row-count": String(total),
      "x-ascent-truncated": String(truncated),
      ...(truncated ? { "x-ascent-row-cap": String(CSV_MAX_ROWS) } : {}),
    },
  });
}

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

  const denied = await requireOrgRead(org);
  if (denied) return denied;

  const filters = auditFiltersFromParams(searchParams);

  if (searchParams.get("format") === "csv") {
    try {
      return await exportCsv(org, filters);
    } catch (err) {
      console.error("[audit] csv export failed", err);
      return NextResponse.json({ error: "Failed to export audit log." }, { status: 500 });
    }
  }

  try {
    // Reuse the same `filters` object the CSV branch passes to exportCsv so both response formats
    // derive their action/actorId/since/until from one place and can't filter differently.
    const page = await getAuditLog(org, {
      ...filters,
      cursor: searchParams.get("cursor"),
      limit: Number(searchParams.get("limit")) || 25,
    });
    return NextResponse.json(page ?? { entries: [], nextCursor: null });
  } catch (err) {
    console.error("[audit] query failed", err);
    return NextResponse.json({ error: "Failed to load audit log." }, { status: 500 });
  }
}
