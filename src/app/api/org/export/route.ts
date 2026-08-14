// GET /api/org/export?org=<slug>&kind=contributors|delivery|passports|teams[&segment=<id>][&stack=<key>][&format=csv]
// Export the org analytics tables as data — JSON by default, or a CSV download (format=csv). Read-only,
// gated to a readable org, and segment-scoped like the pages. Reuses getContributorInsights /
// getOrgGovernance / getOrgRollup / getOrgTeamRollup so the export reflects exactly what the
// Contributors / Delivery / Passports / Teams tabs show.

import { NextResponse } from "next/server";
import { getContributorInsights, getOrgGovernance, getOrgRollup, getOrgTeamRollup, isDbConfigured, listSegments, listTechStackGroups } from "@/lib/db";
import { requireOrgRead } from "@/lib/authz";
import { CHAMPION_MIN_POP } from "@/components/org/shared/champions";
import { csvTable } from "@/lib/export/csv";
import { safeFilenameSlug } from "@/lib/export/filename";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

  // Validate the optional segment against the org's segments. Unlike the pages (where a bogus id
  // degrades inside UI that shows which scope is active), this is a data-egress surface: a CSV leaves
  // the app carrying no scope marker, so silently falling back to the WHOLE fleet on a stale/renamed/
  // typo'd segment id over-exports exactly the slice the caller didn't ask for. Explicit request →
  // explicit failure: fail closed with a 400 instead.
  const segParam = searchParams.get("segment");
  const segmentId = segParam ? (await listSegments(org))?.find((s) => s.id === segParam)?.id ?? null : null;
  if (segParam && !segmentId) {
    return NextResponse.json({ error: "Unknown segment for this org." }, { status: 400 });
  }

  // The tech-stack scope composes with the segment on every page that renders this link, so the
  // export must honor it too — a stack-filtered screen exporting whole-fleet rows is the same
  // over-export hazard as the segment case above. Same fail-closed contract: an explicit ?stack=
  // that doesn't resolve for this org is a 400, never a silent widening.
  const stackParam = searchParams.get("stack");
  const techGroupId = stackParam
    ? (await listTechStackGroups(org)).find((g) => g.key === stackParam)?.id ?? null
    : null;
  if (stackParam && !techGroupId) {
    return NextResponse.json({ error: "Unknown tech stack for this org." }, { status: 400 });
  }

  let header: string[];
  let rows: unknown[][];
  if (kind === "contributors") {
    const insights = await getContributorInsights(org, segmentId, techGroupId);
    // A `null` result means the lookup itself failed/was unavailable — distinct from an org that
    // legitimately has zero contributors (a present object with an empty array). Returning a
    // header-only 200 in the null case is success theater, so surface it as a 404 instead.
    if (!insights) {
      return NextResponse.json({ error: "No analytics for this org yet." }, { status: 404 });
    }
    // Population floor (G4-03). getContributorInsights already withholds every per-person row below
    // CHAMPION_MIN_POP humans, so this branch would otherwise emit a header-only CSV — the same
    // "success theater" the null case above rejects. Say why instead: an export naming 1–2
    // identifiable people is a dossier, not an adoption metric, and unlike the page there is no
    // scope marker on a CSV once it leaves the app. The aggregate view stays available in-app.
    if (!insights.namingAllowed) {
      return NextResponse.json(
        { error: `Per-contributor export is withheld below ${CHAMPION_MIN_POP} contributors: it would name identifiable individuals.` },
        { status: 403 },
      );
    }
    header = ["login", "name", "commits", "aiCommits", "aiSharePct", "repos", "lastActiveAt"];
    rows = insights.contributors.map((c) => [c.login, c.name ?? "", c.commits, c.aiCommits, c.aiShare, c.repos, c.lastActiveAt ?? ""]);
  } else if (kind === "passports") {
    // One row per passport — the Passports tab's table plus the row-detail facts (blockers joined
    // with "; " so the CSV stays one-line-per-repo).
    const rollup = await getOrgRollup(org, undefined, segmentId, techGroupId);
    // Same null contract as the sibling branches: null = unknown org / lookup unavailable → 404, not a
    // header-only 200 that dresses a backend miss up as an empty-but-successful export.
    if (!rollup) {
      return NextResponse.json({ error: "No analytics for this org yet." }, { status: 404 });
    }
    header = [
      "repo", "name", "automationLevel", "automationScore", "productionBand", "productionScore",
      "ci", "ciProvider", "tests", "coveragePct", "security", "observability",
      "migrations", "iac", "rollback", "automationBlockers", "productionBlockers",
    ];
    rows = rollup.repos
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
    const rollup = await getOrgTeamRollup(org, segmentId, techGroupId);
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
    const gov = await getOrgGovernance(org, segmentId, techGroupId);
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
    // A segment-scoped CSV must be distinguishable from a full-fleet one once it leaves the app —
    // encode the scope in the filename (whole-org exports keep the historical name unchanged).
    const scopeSuffix =
      (segmentId ? `-${safeFilenameSlug(segmentId, "segment")}` : "") +
      (stackParam && techGroupId ? `-${safeFilenameSlug(stackParam, "stack")}` : "");
    return new NextResponse(csvTable(header, rows), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="ascent-${kind}-${safeFilenameSlug(org, "org")}${scopeSuffix}.csv"`,
        "cache-control": "private, no-store",
      },
    });
  }
  return NextResponse.json({ org, kind, segment: segmentId, stack: stackParam && techGroupId ? stackParam : null, header, rows }, { headers: { "cache-control": "private, no-store" } });
}
