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

// `orgId` is included because it's one of the fields the per-row HMAC `_sig` (meta cell) is computed
// over — omitting it (as this export used to) made the stated row-level tamper-evidence unverifiable
// from the file alone, since the canonical signed input couldn't be reconstructed (the filename carries
// only the org slug, not the DB orgId).
const CSV_COLUMNS = ["at", "action", "actorId", "orgId", "repo", "level", "overall", "headSha", "meta"] as const;
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
          e.orgId,
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

  const stamp = new Date().toISOString().slice(0, 10);
  const body = lines.join("\n") + "\n";
  return new Response(body, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="ascent-audit-${org}-${stamp}.csv"`,
      "cache-control": "no-store",
      // File-level integrity for the filed evidence (recompute SHA-256 over the bytes to verify). Each
      // row also carries its own HMAC `_sig` in the meta cell, so individual rows are tamper-evident too.
      "x-ascent-content-sha256": sha256Hex(body),
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
