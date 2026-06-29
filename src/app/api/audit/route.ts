// GET /api/audit?org=<slug>[&action=&actorId=&since=&until=&cursor=&limit=][&format=csv]
// Org-scoped audit trail with keyset pagination. Requires DATABASE_URL. `format=csv` streams ALL
// matching rows (cursor-looped, capped) as a download for compliance evidence.
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

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CSV_COLUMNS = ["at", "action", "actorId", "repo", "level", "overall", "headSha", "meta"] as const;
const CSV_MAX_ROWS = 10000; // safety cap so one export can't loop the whole table unbounded

/** Stream the full filtered audit trail as a CSV download (cursor-looped over getAuditLog). */
async function exportCsv(
  org: string,
  filters: { action?: string; actorId?: string; since?: string; until?: string },
): Promise<Response> {
  const lines = [CSV_COLUMNS.join(",")];
  let cursor: string | null = null;
  let total = 0;
  do {
    const page = await getAuditLog(org, { ...filters, cursor, limit: 100 });
    if (!page) break;
    for (const e of page.entries) {
      lines.push(
        [
          e.at,
          e.action,
          e.actorId,
          e.scan?.repo,
          e.scan?.level,
          e.scan?.overall,
          e.scan?.headSha,
          JSON.stringify(e.meta),
        ]
          .map((v) => csvField(v, true)) // audit trail quotes every field uniformly
          .join(","),
      );
      total += 1;
    }
    cursor = page.nextCursor;
  } while (cursor && total < CSV_MAX_ROWS);

  // TRUNCATION HONESTY: the loop also exits at CSV_MAX_ROWS (newest-first, so the OLDEST evidence is
  // dropped). The SHA below signs whatever bytes we emit, so a truncated file would otherwise be filed
  // as complete compliance evidence with a valid integrity hash — false confidence. A still-set cursor
  // means more rows remained, so flag it explicitly (header + a -PARTIAL filename) and tell the operator
  // to narrow the filters to export the rest. The integrity hash still certifies the bytes delivered.
  const truncated = cursor != null;
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

  const filters = {
    action: searchParams.get("action") ?? undefined,
    actorId: searchParams.get("actorId") ?? undefined,
    since: searchParams.get("since") ?? undefined,
    until: searchParams.get("until") ?? undefined,
  };

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
