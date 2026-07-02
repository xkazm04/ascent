// GET /api/org/export?org=<slug>&kind=contributors|delivery|passports|teams[&segment=<id>][&format=csv]
// Export the org analytics tables as data — JSON by default, or a CSV download (format=csv). Read-only,
// gated to a readable org, and segment-scoped like the pages. Reuses getContributorInsights /
// getOrgGovernance / getOrgRollup / getOrgTeamRollup so the export reflects exactly what the
// Contributors / Delivery / Passports / Teams tabs show.

import { NextResponse } from "next/server";
import { getContributorInsights, getOrgGovernance, getOrgRollup, getOrgTeamRollup, isDbConfigured, listSegments } from "@/lib/db";
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
  if (kind !== "contributors" && kind !== "delivery" && kind !== "passports" && kind !== "teams") {
    return NextResponse.json({ error: "kind must be contributors | delivery | passports | teams." }, { status: 400 });
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
    // A `null` result means the lookup itself failed/was unavailable — distinct from an org that
    // legitimately has zero contributors (a present object with an empty array). Returning a
    // header-only 200 in the null case is success theater, so surface it as a 404 instead.
    if (!insights) {
      return NextResponse.json({ error: "No analytics for this org yet." }, { status: 404 });
    }
    header = ["login", "name", "commits", "aiCommits", "aiSharePct", "repos", "lastActiveAt"];
    rows = insights.contributors.map((c) => [c.login, c.name ?? "", c.commits, c.aiCommits, c.aiShare, c.repos, c.lastActiveAt ?? ""]);
  } else if (kind === "passports") {
    // One row per passport — the Passports tab's table plus the row-detail facts (blockers joined
    // with "; " so the CSV stays one-line-per-repo).
    const rollup = await getOrgRollup(org, undefined, segmentId);
    header = [
      "repo", "name", "automationLevel", "automationScore", "productionBand", "productionScore",
      "ci", "ciProvider", "tests", "coveragePct", "security", "observability",
      "migrations", "iac", "rollback", "automationBlockers", "productionBlockers",
    ];
    rows = (rollup?.repos ?? [])
      .filter((r) => r.passport)
      .map((r) => {
        const auto = r.passport!.automationReadiness;
        const prod = r.passport!.productionReadiness;
        return [
          r.fullName, r.name, auto.level, auto.score, prod.band, prod.score,
          prod.ci.level, prod.ci.provider ?? "", prod.tests.level, prod.tests.coveragePct ?? "",
          prod.security.level, prod.observability.level,
          prod.delivery.migrations, prod.delivery.iac, prod.delivery.rollback,
          auto.blockers.join("; "), prod.blockers.join("; "),
        ];
      });
  } else if (kind === "teams") {
    // One row per CODEOWNERS team — the Teams tab's matrix rollup (maturity averages, AI knowledge,
    // and since-last-scan movement).
    const rollup = await getOrgTeamRollup(org, segmentId);
    // Same null contract as contributors/delivery: null = unknown org / lookup unavailable → 404,
    // distinct from an org that legitimately has zero teams (a present shape with `teams: []`).
    if (!rollup) {
      return NextResponse.json({ error: "No analytics for this org yet." }, { status: 404 });
    }
    header = [
      "team", "name", "reposScanned", "reposOwned", "primaryOwnerOf", "avgOverall", "avgAdoption", "avgRigor",
      "posture", "contributors", "aiContributors", "aiCommitSharePct", "comparedRepos", "improving", "declining", "avgDelta",
    ];
    rows = rollup.teams.map((t) => [
      t.slug, t.name, t.repoCount, t.totalOwned, t.defaultOwnerCount, t.avgOverall, t.avgAdoption, t.avgRigor,
      t.posture, t.contributors, t.aiContributors, t.aiCommitShare, t.comparedRepos, t.improving, t.declining, t.avgDelta,
    ]);
  } else {
    const gov = await getOrgGovernance(org, segmentId);
    if (!gov) {
      return NextResponse.json({ error: "No analytics for this org yet." }, { status: 404 });
    }
    header = ["repo", "name", "protected", "requiresPullRequest", "requiredApprovals", "requiresStatusChecks", "requiresSignatures", "ruleCount"];
    rows = gov.perRepo.map((r) => [
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
        "cache-control": "private, no-store",
      },
    });
  }
  return NextResponse.json({ org, kind, header, rows }, { headers: { "cache-control": "private, no-store" } });
}
