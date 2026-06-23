// GET /api/org/export?org=<slug>&kind=contributors|delivery[&segment=<id>][&format=csv]
// Export the org analytics tables as data — JSON by default, or a CSV download (format=csv). Read-only,
// gated to a readable org, and segment-scoped like the pages. Reuses getContributorInsights /
// getOrgGovernance so the export reflects exactly what the Contributors / Delivery tabs show.

import { NextResponse } from "next/server";
import { getContributorInsights, getOrgGovernance, isDbConfigured, listSegments } from "@/lib/db";
import { requireOrgRead } from "@/lib/authz";
import { csvField } from "@/lib/export/csv";
import { safeFilenameSlug } from "@/lib/export/filename";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function toCsv(header: string[], rows: unknown[][]): string {
  return [header.join(","), ...rows.map((r) => r.map((v) => csvField(v)).join(","))].join("\n") + "\n";
}

export async function GET(request: Request) {
  if (!isDbConfigured()) return NextResponse.json({ error: "Export requires a database." }, { status: 503 });
  const { searchParams } = new URL(request.url);
  const org = searchParams.get("org");
  const kind = searchParams.get("kind");
  if (!org) return NextResponse.json({ error: "Missing ?org." }, { status: 400 });
  if (kind !== "contributors" && kind !== "delivery") {
    return NextResponse.json({ error: "kind must be contributors | delivery." }, { status: 400 });
  }
  const denied = await requireOrgRead(org);
  if (denied) return denied;

  // Validate the optional segment against the org's segments (bogus id → whole fleet), like the pages.
  const segParam = searchParams.get("segment");
  const segmentId = segParam ? (await listSegments(org))?.find((s) => s.id === segParam)?.id ?? null : null;

  let header: string[];
  let rows: unknown[][];
  if (kind === "contributors") {
    const insights = await getContributorInsights(org, segmentId);
    header = ["login", "name", "commits", "aiCommits", "aiSharePct", "repos", "lastActiveAt"];
    rows = (insights?.contributors ?? []).map((c) => [c.login, c.name ?? "", c.commits, c.aiCommits, c.aiShare, c.repos, c.lastActiveAt ?? ""]);
  } else {
    const gov = await getOrgGovernance(org, segmentId);
    header = ["repo", "name", "protected", "requiresPullRequest", "requiredApprovals", "requiresStatusChecks", "requiresSignatures", "ruleCount"];
    rows = (gov?.perRepo ?? []).map((r) => [
      r.fullName,
      r.name,
      r.protected,
      r.requiresPullRequest,
      r.requiredApprovals,
      r.requiresStatusChecks,
      r.requiresSignatures,
      r.ruleCount,
    ]);
  }

  if (searchParams.get("format") === "csv") {
    return new NextResponse(toCsv(header, rows), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="ascent-${kind}-${safeFilenameSlug(org, "org")}.csv"`,
      },
    });
  }
  return NextResponse.json({ org, kind, header, rows });
}
