// GET /api/report/skill?repo=owner/name[@sha]  -> text/markdown (an "ascent-onboard" SKILL.md)
//
// Emits the personalized onboarding skill for a persisted maturity report — a scan output the repo
// drops into .claude/skills/ and runs with its own Claude Code CLI. Mirrors the PDF export route:
// read-gated by the owning org (public reports are open; private require org read access), and 404
// when the repo has no saved scan — this reflects an existing report, it never triggers a scan.

import { NextResponse } from "next/server";
import { buildOnboardingSkill, type SelectOpts } from "@/lib/onboarding";
import { isDimensionId } from "@/lib/maturity/model";
import type { DimensionId } from "@/lib/types";
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
  const url = new URL(request.url);
  const q = url.searchParams.get("repo");
  if (!q) return NextResponse.json({ error: "Missing ?repo=owner/name." }, { status: 400 });
  const parsed = parseRepoParam(q);
  if (!parsed) return NextResponse.json({ error: "Invalid repo. Use owner/name." }, { status: 400 });

  // Maintainer multiselect (previously a fully built library API with no route surface): ?tracks=D2,D9
  // forces those dimensions (bypassing the weak-dim filter — e.g. a refinement on a strong dimension),
  // and &max=N caps the track count. Validated against DimensionId and rejected loudly — a typo'd
  // dimension must not silently fall back to the default set.
  let opts: SelectOpts | undefined;
  const tracksParam = url.searchParams.get("tracks");
  const maxParam = url.searchParams.get("max");
  if (tracksParam !== null || maxParam !== null) {
    opts = {};
    if (tracksParam !== null) {
      const ids = [...new Set(tracksParam.split(",").map((s) => s.trim()).filter(Boolean))];
      if (ids.length === 0 || !ids.every(isDimensionId)) {
        return NextResponse.json(
          { error: "Invalid tracks. Use ?tracks=D1,D2,… (comma-separated dimension ids D1–D9)." },
          { status: 400 },
        );
      }
      opts.include = ids as DimensionId[];
    }
    if (maxParam !== null) {
      const max = Number(maxParam);
      if (!Number.isInteger(max) || max < 1) {
        return NextResponse.json({ error: "Invalid max. Use a positive integer." }, { status: 400 });
      }
      opts.max = max;
    }
  }

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

  const skill = opts ? buildOnboardingSkill(report, opts) : buildOnboardingSkill(report);
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
