// GET /api/report/skill?repo=owner/name[@sha]  -> text/markdown (an "ascent-onboard" SKILL.md)
//
// Emits the personalized onboarding skill for a persisted maturity report — a scan output the repo
// drops into .claude/skills/ and runs with its own Claude Code CLI. Mirrors the PDF export route:
// read-gated by the owning org (public reports are open; private require org read access), and 404
// when the repo has no saved scan — this reflects an existing report, it never triggers a scan.

import { NextResponse } from "next/server";
import { buildOnboardingSkill } from "@/lib/onboarding";
import { getScanReportByCommit, isDbConfigured, recordSkillGeneration } from "@/lib/db";
import { readableOrgForOwner } from "@/lib/auth";
import { requireOrgRead } from "@/lib/authz";
import { parseRepoParam } from "@/lib/report/repoParam";
import { safeFilenameSegment } from "@/lib/export/filename";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isDbConfigured())
    return NextResponse.json({ error: "Skill export requires a database." }, { status: 503 });
  const q = new URL(request.url).searchParams.get("repo");
  if (!q) return NextResponse.json({ error: "Missing ?repo=owner/name." }, { status: 400 });
  const parsed = parseRepoParam(q);
  if (!parsed) return NextResponse.json({ error: "Invalid repo. Use owner/name." }, { status: 400 });

  // Resolve the owning org and gate the read — a private report's skill is as sensitive as the report.
  const orgSlug = await readableOrgForOwner(parsed.owner);
  const denied = await requireOrgRead(orgSlug);
  if (denied) return denied;

  const report = await getScanReportByCommit(parsed.owner, parsed.name, {
    headSha: parsed.sha,
    orgSlug,
  }).catch(() => null);
  if (!report) {
    return NextResponse.json(
      { error: "No saved scan for this repository yet. Scan it first, then export." },
      { status: 404 },
    );
  }

  const skill = buildOnboardingSkill(report);
  // STD-6: record the generation (repo, commit, tracks) so the report can show a history + track diff.
  // Fire-and-forget — the download never waits on it, and a failed write is swallowed.
  void recordSkillGeneration(`${parsed.owner}/${parsed.name}`, parsed.sha ?? null, skill.trackIds).catch(() => {});
  // Sanitize every interpolated segment before the Content-Disposition header (the sha is
  // caller-supplied and unvalidated): keep only filename-safe chars so it can't inject a header.
  const filename = `ascent-onboard-${safeFilenameSegment(parsed.owner)}-${safeFilenameSegment(parsed.name)}${
    parsed.sha ? "-" + safeFilenameSegment(parsed.sha.slice(0, 7)) : ""
  }.SKILL.md`;
  return new NextResponse(skill.body, {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "private, max-age=300",
    },
  });
}
