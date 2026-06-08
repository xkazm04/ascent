// GET /api/usage?org=<slug>&days=<n>[&format=csv|json]
// Usage metering for an org over a period. Requires DATABASE_URL (returns 503 when off).
//   - default / format=json (no download): the UsageSummary as JSON
//   - format=csv  -> per-day CSV, as a file download (finance reconciliation)
//   - format=json + download: the summary as a pretty JSON file download

import { NextResponse } from "next/server";
import { getUsageSummary, isDbConfigured, type UsageSummary } from "@/lib/db";
import { getSession, isAuthConfigured } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function toCsv(summary: UsageSummary): string {
  const header = "date,billable,free,total";
  const rows = summary.daily.map((d) => `${d.date},${d.billable},${d.free},${d.billable + d.free}`);
  return [header, ...rows].join("\n") + "\n";
}

// The org slug reaches us straight from the query string (and for the shared "public" org / any
// auth-off deployment it's never membership-checked), so it must never be interpolated raw into a
// response header: a slug containing a quote, CR/LF, or non-ASCII byte would corrupt or spoof the
// Content-Disposition filename (header injection / response-splitting). Reduce it to a safe ASCII
// token for the download name; the real org identity already lives inside the payload.
function safeFilenameSlug(org: string): string {
  const cleaned = org
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return cleaned || "org";
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const org = searchParams.get("org") ?? "public";
  const days = Math.min(365, Math.max(1, Number(searchParams.get("days")) || 30));
  const format = searchParams.get("format");

  if (!isDbConfigured()) {
    return NextResponse.json(
      { error: "Usage metering requires a database (Phase 2 feature)." },
      { status: 503 },
    );
  }

  // Authorize the requested org. The /usage page gates on the session and scopes to the
  // caller's installation org, but this API must enforce the same — otherwise it's an IDOR:
  // anyone could enumerate org slugs and read another tenant's usage volume/timeline. The
  // shared "public" org is readable by anyone; a private org requires a session whose
  // installations include it.
  const orgLc = org.toLowerCase();
  if (orgLc !== "public") {
    if (!isAuthConfigured()) {
      // DB-on + auth-off must NOT become an open multi-tenant usage API: with DATABASE_URL set
      // but OAuth unconfigured (a realistic partial prod config, or a dropped AUTH_SECRET), an
      // anonymous caller could enumerate org slugs and read each tenant's volume/timeline/repo
      // names. Only the shared "public" org is metered without auth; a real org needs it on.
      return NextResponse.json(
        { error: "Per-organization usage requires authentication to be configured." },
        { status: 403 },
      );
    }
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "Sign in to view usage." }, { status: 401 });
    }
    if (!session.installations.some((i) => i.login.toLowerCase() === orgLc)) {
      return NextResponse.json(
        { error: "You don't have access to this org's usage." },
        { status: 403 },
      );
    }
  }

  try {
    const summary = await getUsageSummary(org, days);
    if (!summary) {
      return NextResponse.json({ error: "Failed to load usage." }, { status: 500 });
    }

    const stamp = new Date().toISOString().slice(0, 10);
    const fileOrg = safeFilenameSlug(org);
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
