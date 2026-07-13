// POST /api/org/skills/push { org, name, content, category?, description?, tags?, baseVersion? }
//   -> 200 { status: "created"|"updated"|"unchanged", id, version }
//   -> 409 { status: "conflict", id, version, error }   (baseVersion is stale — rebase and retry)
// The write half of the sync loop: register a skill by name, or update the existing one. Optimistic
// concurrency via `baseVersion` (the version the client last synced) means a stale local copy can't
// clobber a newer server edit. Write-gated (token skills:write or session) AND Team+ — the token is
// identity, not an entitlement bypass. `unchanged` (identical body) is idempotent: re-running never churns.

import { NextResponse } from "next/server";
import { getCreditState, isDbConfigured, pushOrgSkill, recordOrgAudit } from "@/lib/db";
import { authorizeOrgApi, isDenied, principalLogin } from "@/lib/api-token-auth";
import { planAllowsSkillsLibrary } from "@/lib/plans";
import { SKILL_CATEGORIES, isSkillCategory } from "@/lib/org/skill-categories";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isDbConfigured()) return NextResponse.json({ error: "Skills require a database." }, { status: 503 });
  const body = (await request.json().catch(() => ({}))) as {
    org?: string;
    name?: string;
    content?: string;
    category?: string;
    description?: string;
    tags?: string[];
    baseVersion?: number;
  };
  if (!body.org || !body.name?.trim() || !body.content?.trim()) {
    return NextResponse.json({ error: "Provide { org, name, content }." }, { status: 400 });
  }
  if (body.category !== undefined && !isSkillCategory(body.category)) {
    return NextResponse.json({ error: `category must be one of: ${SKILL_CATEGORIES.join(", ")}.` }, { status: 400 });
  }
  const auth = await authorizeOrgApi(request, body.org, { scope: "skills:write", mode: "write" });
  if (isDenied(auth)) return auth.denied;
  const credit = await getCreditState(body.org).catch(() => null);
  if (!planAllowsSkillsLibrary(credit?.plan)) {
    return NextResponse.json({ error: "The Skills Library is a Team-plan feature." }, { status: 403 });
  }

  const actorLogin = await principalLogin(auth.principal);
  const baseVersion = typeof body.baseVersion === "number" ? body.baseVersion : undefined;
  try {
    const result = await pushOrgSkill(
      body.org,
      {
        name: body.name,
        content: body.content,
        category: body.category ?? "other",
        description: body.description,
        tags: Array.isArray(body.tags) ? body.tags : undefined,
      },
      { baseVersion, createdBy: actorLogin },
    );
    if (!result) return NextResponse.json({ error: "Failed to push skill." }, { status: 500 });
    if (result.status === "conflict") {
      return NextResponse.json(
        { ...result, error: `Server has version ${result.version}; you pushed against ${baseVersion}. Pull and retry.` },
        { status: 409 },
      );
    }
    if (result.status === "created" || result.status === "updated") {
      await recordOrgAudit(`org_skill.${result.status}`, body.org, { skillId: result.id, name: body.name.trim(), via: "push" }, actorLogin ?? undefined);
    }
    return NextResponse.json(result);
  } catch (err) {
    if ((err as { code?: string }).code === "P2002") {
      return NextResponse.json({ error: "A skill with that name already exists." }, { status: 409 });
    }
    return NextResponse.json({ error: "Failed to push skill." }, { status: 500 });
  }
}
