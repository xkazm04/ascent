// GET /api/report/skill?repo=owner/name[@sha]  -> text/markdown (an "ascent-onboard" SKILL.md)
//
// Emits the personalized onboarding skill for a persisted maturity report — a scan output the repo
// drops into .claude/skills/ and runs with its own Claude Code CLI. Mirrors the PDF export route:
// read-gated by the owning org (public reports are open; private require org read access), and 404
// when the repo has no saved scan — this reflects an existing report, it never triggers a scan.

import { NextResponse } from "next/server";
import { buildOnboardingSkill } from "@/lib/onboarding";
import { getScanReportByCommit, isDbConfigured } from "@/lib/db";
import { readableOrgForOwner } from "@/lib/auth";
import { requireOrgRead } from "@/lib/authz";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseRepo(q: string): { owner: string; name: string; sha?: string } | null {
  const at = q.indexOf("@");
  const base = at < 0 ? q : q.slice(0, at);
  const sha = at < 0 ? undefined : q.slice(at + 1) || undefined;
  const slash = base.indexOf("/");
  if (slash <= 0 || slash === base.length - 1) return null;
  return { owner: base.slice(0, slash), name: base.slice(slash + 1), sha };
}

export async function GET(request: Request) {
  if (!isDbConfigured())
    return NextResponse.json({ error: "Skill export requires a database." }, { status: 503 });
  const q = new URL(request.url).searchParams.get("repo");
  if (!q) return NextResponse.json({ error: "Missing ?repo=owner/name." }, { status: 400 });
  const parsed = parseRepo(q);
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
  const filename = `ascent-onboard-${parsed.owner}-${parsed.name}${
    parsed.sha ? "-" + parsed.sha.slice(0, 7) : ""
  }.SKILL.md`;
  return new NextResponse(skill.body, {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "private, max-age=300",
    },
  });
}
