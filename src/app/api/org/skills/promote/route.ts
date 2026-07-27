// POST /api/org/skills/promote { org, repo: "owner/name[@sha]" } -> { id, name, trackIds }
//
// The PROMOTION BRIDGE: takes a repo's generated onboarding SKILL.md (the scan output at
// /api/report/skill) and files it in the org's Skills Library as a first-class, versioned entry —
// unifying Ascent's generated-skill and library-skill systems. Same write gates as a normal create
// (member + Team-plan/personal-workspace + the personal skill cap) PLUS a read gate on the SOURCE repo:
// the report is resolved through the caller's readable org, so a private repo's skill can't be promoted
// (and thereby read) from an org that can't see it. 409 when this repo was already promoted.
//
// Note the source-repo read gate is session-based (readableOrgForOwner): a machine token that can write
// the library still only promotes what a signed-in viewer could read — private reports fall through to
// the 404 below rather than leaking.

import { NextResponse } from "next/server";
import {
  createOrgSkill,
  getCreditState,
  getScanReportByCommit,
  isDbConfigured,
  personalSkillCapReached,
  recordOrgAudit,
  workspaceAllowsSkills,
  PERSONAL_SKILL_LIMIT,
} from "@/lib/db";
import { authorizeOrgApi, isDenied, principalLogin } from "@/lib/api-token-auth";
import { readableOrgForOwner } from "@/lib/auth";
import { requireOrgRead } from "@/lib/authz";
import { parseRepoParam } from "@/lib/report/repoParam";
import { buildPromotedSkill } from "@/lib/org/skill-promote";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isDbConfigured()) return NextResponse.json({ error: "Skills require a database." }, { status: 503 });
  const body = (await request.json().catch(() => ({}))) as { org?: string; repo?: string };
  if (!body.org || !body.repo?.trim()) {
    return NextResponse.json({ error: 'Provide { org, repo: "owner/name" }.' }, { status: 400 });
  }
  const parsed = parseRepoParam(body.repo);
  if (!parsed) return NextResponse.json({ error: "Invalid repo. Use owner/name." }, { status: 400 });

  const auth = await authorizeOrgApi(request, body.org, { scope: "skills:write", mode: "write" });
  if (isDenied(auth)) return auth.denied;
  // Same entitlement chain as POST /api/org/skills — promotion is a create, not a back door around it.
  const credit = await getCreditState(body.org).catch(() => null);
  if (!(await workspaceAllowsSkills(body.org, credit?.plan))) {
    return NextResponse.json({ error: "The Skills Library is a Team-plan feature." }, { status: 403 });
  }
  if (await personalSkillCapReached(body.org, credit?.plan)) {
    return NextResponse.json(
      { error: `Personal skills are capped at ${PERSONAL_SKILL_LIMIT}. Archive one to author another.` },
      { status: 402 },
    );
  }

  // Read gate on the SOURCE: resolve the owning org the caller may read, then scope the report fetch to
  // it — an unreadable private report simply isn't found (404), never promoted.
  const sourceOrg = await readableOrgForOwner(parsed.owner);
  const denied = await requireOrgRead(sourceOrg);
  if (denied) return denied;
  const report = await getScanReportByCommit(parsed.owner, parsed.name, {
    headSha: parsed.sha,
    orgSlug: sourceOrg,
  }).catch(() => null);
  if (!report) {
    return NextResponse.json(
      { error: "No saved scan for this repository yet. Scan it first, then promote." },
      { status: 404 },
    );
  }

  const skill = buildPromotedSkill(report);
  const actorLogin = await principalLogin(auth.principal);
  try {
    const created = await createOrgSkill(
      body.org,
      {
        name: skill.name,
        category: skill.category,
        content: skill.content,
        description: skill.description,
        tags: skill.tags,
      },
      actorLogin,
    );
    if (!created) return NextResponse.json({ error: "Failed to promote skill." }, { status: 500 });
    await recordOrgAudit(
      "org_skill.created",
      body.org,
      { skillId: created.id, name: skill.name, via: "promote", repo: `${parsed.owner}/${parsed.name}` },
      actorLogin ?? undefined,
    );
    return NextResponse.json({ id: created.id, name: skill.name, trackIds: skill.trackIds });
  } catch (err) {
    if ((err as { code?: string }).code === "P2002") {
      return NextResponse.json(
        { error: `"${skill.name}" is already in the library. Edit or archive it before promoting again.` },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: "Failed to promote skill." }, { status: 500 });
  }
}
