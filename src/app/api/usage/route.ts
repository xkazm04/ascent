// GET /api/usage?org=<slug>&days=<n>[&format=csv|json]
// Usage metering for an org over a period. Requires DATABASE_URL (returns 503 when off).
//   - default / format=json (no download): the UsageSummary as JSON
//   - format=csv  -> per-day CSV, as a file download (finance reconciliation)
//   - format=json + download: the summary as a pretty JSON file download

import { NextResponse } from "next/server";
import { getUsageSummary, isDbConfigured, type UsageSummary } from "@/lib/db";
import { boundUsageDays } from "@/lib/db/usage";
import { requireOrgRead } from "@/lib/authz";
import { csvTable } from "@/lib/export/csv";
import { safeFilenameSlug } from "@/lib/export/filename";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// date is a plain "YYYY-MM-DD" dayKey and billable/free/total are non-negative counts — both shapes are
// exempt from csvField's quoting/formula-guard (no comma/quote/newline, and a leading digit never trips
// the `=/+/-/@` formula check), so routing this through the shared csvTable is byte-identical to the
// former hand-rolled template-literal join.
function toCsv(summary: UsageSummary): string {
  const header = ["date", "billable", "free", "total"];
  const rows = summary.daily.map((d) => [d.date, d.billable, d.free, d.billable + d.free]);
  return csvTable(header, rows);
}

/**
 * The SHOWBACK export (`?view=showback`): one row per inference lane and one per code-owning team,
 * with the `lane` and `team` columns a finance reader needs to allocate the bill.
 *
 * A SEPARATE view rather than columns bolted onto the per-day export, deliberately: the day series is
 * a reconciliation artifact whose shape (`date,billable,free,total`) downstream sheets already key
 * on, and a lane is not a property of a day's scan count. Both go through the shared `csvTable`, so
 * the formula-injection guard and the quoting rules are the same ones every other export uses.
 *
 * `team` is OMITTED entirely for the public funnel: the shared anonymous org has no teams, and its
 * summary is anonymously readable, so it must not carry an attribution column at all.
 *
 * `estimatedCostUsd` is EMPTY, never `0`, when a row could not be priced — `unpricedCalls` says how
 * many calls that was. A zero in a finance export is a claim about money that was not spent.
 */
function toShowbackCsv(summary: UsageSummary, isPublic: boolean): string {
  const header = isPublic
    ? ["scope", "lane", "calls", "estimatedCostUsd", "unpricedCalls"]
    : ["scope", "lane", "team", "calls", "estimatedCostUsd", "unpricedCalls"];
  const money = (v: number | null) => (v == null ? "" : v.toFixed(6));
  const rows: unknown[][] = summary.byLane.map((l) =>
    isPublic
      ? ["lane", l.lane, l.calls, money(l.estimatedCostUsd), l.unpricedCalls]
      : ["lane", l.lane, "", l.calls, money(l.estimatedCostUsd), l.unpricedCalls],
  );
  if (!isPublic) {
    for (const t of summary.byTeam) {
      rows.push(["team", "", t.label, t.calls, money(t.estimatedCostUsd), ""]);
    }
  }
  return csvTable(header, rows);
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const org = searchParams.get("org") ?? "public";
  const orgLc = org.toLowerCase();
  // Bound the window via the shared boundUsageDays (single-sourced with the /usage page so the two
  // can't drift). A private (authenticated) org may request up to a year; the UNAUTHENTICATED public
  // org is capped tighter (90d) so an anonymous caller can't repeatedly force a 365-day, ~10-aggregate
  // full-window scan as a cheap DoS lever. Non-numeric input falls back to 30, and a FRACTIONAL ?days=
  // is floored — an un-floored 1.5 dropped the newest day from the per-day CSV while the counts kept it.
  const days = boundUsageDays(searchParams.get("days"), orgLc === "public");
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
    // The showback view rides the SAME auth, window and IDOR guard as everything else on this route —
    // it is a different projection of the summary already computed, not a new surface.
    if (searchParams.get("view") === "showback") {
      return new NextResponse(toShowbackCsv(summary, orgLc === "public"), {
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="ascent-showback-${fileOrg}-${stamp}.csv"`,
        },
      });
    }
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
