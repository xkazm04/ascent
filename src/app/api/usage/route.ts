// GET /api/usage?org=<slug>&days=<n>[&format=csv|json]
// Usage metering for an org over a period. Requires DATABASE_URL (returns 503 when off).
//   - default / format=json (no download): the UsageSummary as JSON
//   - format=csv  -> per-day CSV, as a file download (finance reconciliation)
//   - format=json + download: the summary as a pretty JSON file download

import { NextResponse } from "next/server";
import { getUsageSummary, isDbConfigured, type UsageSummary } from "@/lib/db";
import { requireOrgRead } from "@/lib/authz";
import { safeFilenameSlug } from "@/lib/export/filename";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function toCsv(summary: UsageSummary): string {
  const header = "date,billable,free,total";
  const rows = summary.daily.map((d) => `${d.date},${d.billable},${d.free},${d.billable + d.free}`);
  return [header, ...rows].join("\n") + "\n";
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const org = searchParams.get("org") ?? "public";
  const orgLc = org.toLowerCase();
  // Bound the window. A private (authenticated) org may request up to a year; the UNAUTHENTICATED
  // public org is capped tighter (90d) so an anonymous caller can't repeatedly force a 365-day,
  // ~10-aggregate full-window scan as a cheap DoS lever. Non-numeric input falls back to 30.
  const days = Math.min(orgLc === "public" ? 90 : 365, Math.max(1, Number(searchParams.get("days")) || 30));
  const format = searchParams.get("format");

  if (!isDbConfigured()) {
    return NextResponse.json(
      { error: "Usage metering requires a database (Phase 2 feature)." },
      { status: 503 },
    );
  }

  // Authorize the requested org with the canonical read-side tenant gate (closes the cross-tenant
  // read IDOR — anyone could otherwise enumerate org slugs and read another tenant's usage). This
  // replaces a hand-rolled copy of the same decision: requireOrgRead opens PUBLIC_ORG to everyone,
  // refuses a private org without a session, requires installation membership, AND additionally
  // honors the Supabase login wall + the ASCENT_OPEN_ORG_DASHBOARDS opt-in the inline copy missed.
  const denied = await requireOrgRead(org);
  if (denied) return denied;

  try {
    const summary = await getUsageSummary(org, days);
    if (!summary) {
      return NextResponse.json({ error: "Failed to load usage." }, { status: 500 });
    }

    const stamp = new Date().toISOString().slice(0, 10);
    // Sanitize the caller-supplied slug before it reaches the Content-Disposition header (the public
    // org / auth-off path is never membership-checked). 64-char cap preserved from the prior inline copy.
    const fileOrg = safeFilenameSlug(org, "org", 64);
    if (format === "csv") {
      return new NextResponse(toCsv(summary), {
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="ascent-usage-${fileOrg}-${stamp}.csv"`,
        },
      });
    }
    if (format === "json") {
      return new NextResponse(JSON.stringify(summary, null, 2), {
        headers: {
          "content-type": "application/json; charset=utf-8",
          "content-disposition": `attachment; filename="ascent-usage-${fileOrg}-${stamp}.json"`,
        },
      });
    }

    return NextResponse.json(summary);
  } catch (err) {
    console.error("[usage] query failed", err);
    return NextResponse.json({ error: "Failed to load usage." }, { status: 500 });
  }
}
