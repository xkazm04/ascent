// GET /api/org/repo-dimension?org=X&repo=owner/name&dim=D1  →  one dimension's detail for a repo.
//
// Powers the Repositories heatmap's cell-click modal. The heatmap grid is fed by the lean org rollup
// (just {dimId, score} per cell). The RICH per-dimension metadata (summary/evidence/strengths/gaps,
// the signal↔LLM provenance, and the dimension's tracked recommendations, the "next steps") lives on
// ScanDimension / Recommendation and is fetched HERE, on demand, so the fleet page payload stays small. Read-gated by
// canReadOrg (the endpoint is directly reachable, not just from the already-authorized page), and the
// underlying getScanReportByCommit re-checks tenant scope — a private repo never leaks cross-org.

import { NextResponse } from "next/server";
import { getLatestRecommendations, getScanReportByCommit, getRepositoryHistory } from "@/lib/db";
import type { PersistedRecommendation } from "@/lib/types";
import { canReadOrg, requireOrgAccess } from "@/lib/authz";
import { resolveViewerLogin } from "@/lib/access";
import { PUBLIC_ORG } from "@/lib/org-constants";
import { respondError } from "@/lib/api/respond";
import { degradedRead, noteReadFailure } from "@/lib/org/degraded-read";
import { buildSteps } from "@/lib/org/dimensionStepsModel";

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
  // A FAILED read is not "no scan": the report read answers 503 (reported); the history read only draws
  // the sparkline, so it degrades to an empty series with a door.
  //
  // The persisted recommendations run beside them: they carry the id, status, owner and due date the
  // roadmap drops, so a dismissed or done step is never shown as open. `strict` makes a FAILED read
  // throw instead of resolving null, because a failed tracking read is not "nothing tracked" (it
  // would show every step as open): it degrades to the bare roadmap WITH a trackingError flag.
  const [read, history, recsRead] = await Promise.all([
    getScanReportByCommit(owner, name, { orgSlug: org }).then(
      (report) => ({ ok: true as const, report }),
      (err: unknown) => ({ ok: false as const, err }),
    ),
    getRepositoryHistory(owner, name, { orgSlug: org, limit: 12 }).catch(degradedRead("repo-dimension history", null)),
    getLatestRecommendations(owner, name, { orgSlug: org, strict: true }).then(
      (r) => ({ ok: true as const, items: (r?.items ?? null) as PersistedRecommendation[] | null }),
      (err: unknown) => {
        noteReadFailure("repo-dimension recommendations", err);
        return { ok: false as const, items: null };
      },
    ),
  ]);
  if (!read.ok) return respondError(503, "Couldn't load this repository's scan right now. Try again.", { cause: read.err });
  const report = read.report;
  if (!report) {
    return NextResponse.json({ error: "No stored scan for this repository." }, { status: 404 });
  }
  const dimension = report.dimensions.find((d) => d.id === dim);
  if (!dimension) {
    return NextResponse.json({ error: `Dimension ${dim} isn't in the latest scan.` }, { status: 404 });
  }
  // The roadmap items for this dimension, untracked. Kept one release for any reader of the old
  // payload; the modal reads `steps` below.
  const nextSteps = report.roadmap.filter((r) => r.dimension === dim);
  const steps = buildSteps(dim, recsRead.items, report.roadmap);
  const tracked = recsRead.items !== null;
  // canAct: may this viewer write a verdict through PATCH /api/recommendations/:id? The same gate that
  // route applies (requireOrgAccess on the row's org, which is this org: the recs read is org-scoped),
  // plus its public-org 403. False when nothing is tracked, so no control is offered that would fail.
  const canAct =
    tracked &&
    org !== PUBLIC_ORG &&
    (await requireOrgAccess(org).then(
      (denied) => denied === null,
      degradedRead("repo-dimension write access", false),
    ));
  const viewerLogin = canAct
    ? await resolveViewerLogin().catch(degradedRead("repo-dimension viewer login", null))
    : null;

  // This dimension's score over its recent scans. history.scans is most-recent-first; keep only scans
  // that carry the dim (a legacy scan predating it simply doesn't plot), take prevScore from the point
  // BEFORE the latest (the "since last scan" delta), and reverse to oldest→newest for the sparkline.
  const points = (history?.scans ?? [])
    .map((s) => ({ at: s.scannedAt, score: s.dimensions?.find((x) => x.dimId === dim)?.score }))
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
    steps,
    tracked,
    ...(recsRead.ok ? {} : { trackingError: true }),
    canAct,
    viewerLogin,
    series,
    prevScore,
    // The provenance track cannot draw THIS dimension's real band without it: a flagged dimension's
    // guardband is DOUBLED and the realized blend weight shrinks how far the model could move the
    // number. Omitted — never null-padded — on a row scored before the field, which the track renders
    // as "the blend weight was not recorded", not as a weight of zero.
    ...(report.scoreIntegrity ? { scoreIntegrity: report.scoreIntegrity } : {}),
  });
}
