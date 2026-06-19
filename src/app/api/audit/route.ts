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
import { requireOrgRead } from "@/lib/authz";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * RFC-4180 CSV cell: wrap in quotes and double any embedded quotes; null/undefined → empty.
 * Also neutralizes spreadsheet formula injection — a cell whose first char is = + - @ can
 * execute as a formula in Excel/Sheets, so it is prefixed with ' to force literal text. Since
 * `action`/`actorId`/`meta` are caller- and attacker-influencable, this guard keeps the
 * compliance-evidence export from turning a crafted audit row into a live formula.
 */
function csvCell(v: unknown): string {
  const s = v == null ? "" : String(v);
  const escaped = s.replace(/"/g, '""');
  return /^[=+\-@]/.test(s) ? `"'${escaped}"` : `"${escaped}"`;
}

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
          .map(csvCell)
          .join(","),
      );
      total += 1;
    }
    cursor = page.nextCursor;
  } while (cursor && total < CSV_MAX_ROWS);

  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(lines.join("\n") + "\n", {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="ascent-audit-${org}-${stamp}.csv"`,
      "cache-control": "no-store",
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
