// GET /api/report/skill?repo=owner/name[@sha][&dims=D2,D9][&max=3]  -> text/markdown (an
// "ascent-onboard" SKILL.md)
//
// Emits the personalized onboarding skill for a persisted maturity report — a scan output the repo
// drops into .claude/skills/ and runs with its own Claude Code CLI. Mirrors the PDF export route:
// read-gated by the owning org (public reports are open; private require org read access), and 404
// when the repo has no saved scan — this reflects an existing report, it never triggers a scan.
//
// `dims` / `max` are the MAINTAINER'S SELECTION: buildOnboardingSkill has always accepted a
// SelectOpts include/max (so a session can be scoped to one dimension, or ask for a refinement track
// on a dimension the repo is already strong on), but the route never passed it — nobody could reach
// that. Both are strictly validated here: an unknown dimension id is a 400, never a silently-ignored
// param, because silently dropping it would hand back a DIFFERENT skill than the caller asked for and
// then record that other selection in the generation history.

import { NextResponse } from "next/server";
import { buildOnboardingSkill } from "@/lib/onboarding";
import { getScanReportByCommit, isDbConfigured, recordSkillGeneration } from "@/lib/db";
import { readableOrgForOwner } from "@/lib/auth";
import { requireOrgRead } from "@/lib/authz";
import { parseRepoParam } from "@/lib/report/repoParam";
import { safeFilenameSegment } from "@/lib/export/filename";
import { isDimensionId } from "@/lib/maturity/model";
import type { DimensionId } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The maintainer's track selection, or an error string naming exactly what was rejected. */
type SelectParams = { include?: DimensionId[]; max?: number };

function parseSelection(params: URLSearchParams): SelectParams | { error: string } {
  const out: SelectParams = {};

  // `dims` accepts a comma-separated list and/or repeated params, so both ?dims=D2,D9 and
  // ?dims=D2&dims=D9 work. Order is preserved but not load-bearing — selectTracks re-sorts by leverage.
  const raw = params.getAll("dims").flatMap((v) => v.split(","));
  const tokens = raw.map((t) => t.trim().toUpperCase()).filter(Boolean);
  if (raw.length > 0) {
    const bad = tokens.filter((t) => !isDimensionId(t));
    if (bad.length || tokens.length === 0) {
      return { error: `Unknown dimension id${bad.length > 1 ? "s" : ""}: ${bad.join(", ") || "(empty)"}. Use D1..D9.` };
    }
    out.include = [...new Set(tokens)] as DimensionId[];
  }

  const maxRaw = params.get("max");
  if (maxRaw !== null) {
    const n = Number(maxRaw);
    // Integer 1..9 — there are only nine dimensions, so anything else is a caller bug, not a clamp.
    if (!Number.isInteger(n) || n < 1 || n > 9) {
      return { error: `Invalid max: ${maxRaw}. Use an integer 1-9.` };
    }
    out.max = n;
  }
  return out;
}

export async function GET(request: Request) {
  if (!isDbConfigured())
    return NextResponse.json({ error: "Skill export requires a database." }, { status: 503 });
  const params = new URL(request.url).searchParams;
  const q = params.get("repo");
  if (!q) return NextResponse.json({ error: "Missing ?repo=owner/name." }, { status: 400 });
  const parsed = parseRepoParam(q);
  if (!parsed) return NextResponse.json({ error: "Invalid repo. Use owner/name." }, { status: 400 });
  const selection = parseSelection(params);
  if ("error" in selection) return NextResponse.json({ error: selection.error }, { status: 400 });

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

  const skill = buildOnboardingSkill(report, selection);
  // STD-6: record the generation (repo, commit, tracks) so the report can show a history + track diff.
  // `skill.trackIds` is what was actually RENDERED — the maintainer's ?dims selection when one was
  // given, the auto-picked weak set otherwise — so the history reflects the chosen set, not the rubric.
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
