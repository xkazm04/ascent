// GET /api/report/skill?repo=owner/name[@sha][&dims=D2,D9][&max=3][&format=json][&view=outcomes]
//   default         -> text/markdown (Claude's `.claude/skills/ascent-onboard/SKILL.md`)
//   format=json     -> both homes: Claude's path plus the vendor-neutral `.agents/skills/` copy
//   view=outcomes   -> JSON last-run generation outcome (verifiedDelta + tracks); does not record
//                      a generation and does not emit the skill file
//
// Emits the personalized onboarding skill for a persisted maturity report — a scan output the repo
// drops into `.claude/skills/` (Claude Code, kept) and `.agents/skills/` (vendor-neutral). Mirrors
// the PDF export route: read-gated by the owning org (public reports are open; private require org
// read access), and 404 when the repo has no saved scan — this reflects an existing report, it never
// triggers a scan. Default download stays the Claude file so SkillDownload keeps working.
//
// `dims` / `max` are the MAINTAINER'S SELECTION: buildOnboardingSkill has always accepted a
// SelectOpts include/max (so a session can be scoped to one dimension, or ask for a refinement track
// on a dimension the repo is already strong on), but the route never passed it — nobody could reach
// that. Both are strictly validated here: an unknown dimension id is a 400, never a silently-ignored
// param, because silently dropping it would hand back a DIFFERENT skill than the caller asked for and
// then record that other selection in the generation history.

import { NextResponse } from "next/server";
import { buildOnboardingSkill } from "@/lib/onboarding";
import { isDimensionId } from "@/lib/maturity/model";
import type { DimensionId } from "@/lib/types";
import { getScanReportByCommit, isDbConfigured, recordSkillGeneration } from "@/lib/db";
import { getLatestSkillGenerationOutcome, lastRunOutcomeLine } from "@/lib/db/skill-history";
import { readableOrgForOwner } from "@/lib/auth";
import { requireOrgRead } from "@/lib/authz";
import { parseRepoParam } from "@/lib/report/repoParam";
import { safeFilenameSegment } from "@/lib/export/filename";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The maintainer's track selection, or an error string naming exactly what was rejected. */
type SelectParams = { include?: DimensionId[]; max?: number };

function parseSelection(params: URLSearchParams): SelectParams | { error: string } {
  const out: SelectParams = {};

  // `dims` accepts a comma-separated list and/or repeated params, so both ?dims=D2,D9 and
  // ?dims=D2&dims=D9 work. Order is preserved but not load-bearing — selectTracks re-sorts by leverage.
  // `tracks` is the alias the route shipped under first; both name the same selection, so a caller
  // written against either spelling keeps working.
  const raw = [...params.getAll("dims"), ...params.getAll("tracks")].flatMap((v) => v.split(","));
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

  // Outcomes is a read of generation history, not a download. Skip selection parsing (and the
  // generation write below) so the download control can poll without minting a history row.
  const outcomesView = params.get("view") === "outcomes";
  let selection: SelectParams = {};
  if (!outcomesView) {
    const parsedSelection = parseSelection(params);
    if ("error" in parsedSelection) return NextResponse.json({ error: parsedSelection.error }, { status: 400 });
    selection = parsedSelection;
  }

  // Resolve the owning org and gate the read — a private report's skill is as sensitive as the report.
  const orgSlug = await readableOrgForOwner(parsed.owner);
  const denied = await requireOrgRead(orgSlug);
  if (denied) return denied;

  if (outcomesView) {
    const last = await getLatestSkillGenerationOutcome(`${parsed.owner}/${parsed.name}`, orgSlug).catch(() => null);
    return NextResponse.json(
      { last, line: last ? lastRunOutcomeLine(last) : null },
      { headers: { "cache-control": "private, no-store" } },
    );
  }

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
  //
  // The commit recorded is the REPORT's head sha, not the caller's `?repo=…@sha` suffix. Those differ
  // whenever the caller omits the suffix (the report header's own link does when repo.headSha is
  // absent, and any hand-typed/shared URL does): the old `parsed.sha ?? null` then wrote a
  // headSha=null row that dedups SEPARATELY from the sha'd rows of the very same generation, so one
  // report accumulated duplicate history entries and its track diff compared a null-sha row against a
  // sha'd one. The report is the authority on which commit was actually scored.
  void recordSkillGeneration(
    `${parsed.owner}/${parsed.name}`,
    report.repo.headSha ?? parsed.sha ?? null,
    skill.trackIds,
  ).catch(() => {});
  // Sanitize every interpolated segment before the Content-Disposition header (the sha is
  // caller-supplied and unvalidated): keep only filename-safe chars so it can't inject a header.
  const stem = `ascent-onboard-${safeFilenameSegment(parsed.owner)}-${safeFilenameSegment(parsed.name)}${
    parsed.sha ? "-" + safeFilenameSegment(parsed.sha.slice(0, 7)) : ""
  }`;
  if (params.get("format") === "json") {
    return NextResponse.json(
      {
        name: skill.name,
        path: skill.path,
        body: skill.body,
        trackIds: skill.trackIds,
        files: skill.files.map((f) => ({ path: f.path, body: f.body })),
      },
      {
        headers: {
          "content-disposition": `attachment; filename="${stem}.skill.json"`,
          "cache-control": "private, max-age=300",
        },
      },
    );
  }
  return new NextResponse(skill.body, {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "content-disposition": `attachment; filename="${stem}.SKILL.md"`,
      "cache-control": "private, max-age=300",
    },
  });
}
