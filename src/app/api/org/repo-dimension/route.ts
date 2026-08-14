// GET /api/org/repo-dimension?org=X&repo=owner/name&dim=D1  →  one dimension's detail for a repo.
//
// Powers the Repositories heatmap's cell-click modal. The heatmap grid is fed by the lean org rollup
// (just {dimId, score} per cell); the RICH per-dimension metadata — summary/evidence/strengths/gaps,
// the signal↔LLM provenance, and the open recommendations ("next steps") — lives on ScanDimension /
// Recommendation and is fetched HERE, on demand, so the fleet page payload stays small. Read-gated by
// canReadOrg (the endpoint is directly reachable, not just from the already-authorized page), and the
// underlying getScanReportByCommit re-checks tenant scope — a private repo never leaks cross-org.

import { NextResponse } from "next/server";
import { getScanReportByCommit, getRepositoryHistory } from "@/lib/db";
import { canReadOrg } from "@/lib/authz";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const org = searchParams.get("org")?.trim().toLowerCase();
  const repo = searchParams.get("repo")?.trim();
  const dim = searchParams.get("dim")?.trim().toUpperCase();
  if (!org || !repo || !dim) {
    return NextResponse.json({ error: "Missing 'org', 'repo', or 'dim'." }, { status: 400 });
  }
  if (!(await canReadOrg(org))) {
    return NextResponse.json({ error: "Not authorized for this organization." }, { status: 403 });
  }
  const slash = repo.indexOf("/");
  if (slash <= 0 || slash === repo.length - 1) {
    return NextResponse.json({ error: "Invalid 'repo': expected owner/name." }, { status: 400 });
  }
  const owner = repo.slice(0, slash);
  const name = repo.slice(slash + 1);

  // The latest scan (rich per-dim detail) + this dimension's score history run in parallel — a paid
  // drill-in earns the second query, and the modal reads both to answer "where is it" AND "which way".
  const [report, history] = await Promise.all([
    getScanReportByCommit(owner, name, { orgSlug: org }).catch(() => null),
    getRepositoryHistory(owner, name, { orgSlug: org, limit: 12 }).catch(() => null),
  ]);
  if (!report) {
    return NextResponse.json({ error: "No stored scan for this repository." }, { status: 404 });
  }
  const dimension = report.dimensions.find((d) => d.id === dim);
  if (!dimension) {
    return NextResponse.json({ error: `Dimension ${dim} isn't in the latest scan.` }, { status: 404 });
  }
  // Open roadmap items for this dimension are the "next steps" — the same recommendations the report
  // roadmap surfaces, scoped to the one dimension the user clicked.
  const nextSteps = report.roadmap.filter((r) => r.dimension === dim);

  // This dimension's score over its recent scans. history.scans is most-recent-first; keep only scans
  // that carry the dim (a legacy scan predating it simply doesn't plot), take prevScore from the point
  // BEFORE the latest (the "since last scan" delta), and reverse to oldest→newest for the sparkline.
  const points = (history?.scans ?? [])
    .map((s) => ({ at: s.scannedAt, score: s.dimensions.find((x) => x.dimId === dim)?.score }))
    .filter((p): p is { at: string; score: number } => p.score != null);
  const prevScore = points.length >= 2 ? points[1]!.score : undefined;
  const series = points.slice().reverse();

  return NextResponse.json({
    repo: `${owner}/${name}`,
    scannedAt: report.scannedAt,
    overall: report.overallScore,
    level: { id: report.level.id, name: report.level.name },
    dimension,
    nextSteps,
    series,
    prevScore,
  });
}
