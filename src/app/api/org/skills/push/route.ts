// POST /api/org/skills/push { org, name, content, category?, description?, tags?, baseVersion? }
//   -> 200 { status: "created"|"updated"|"unchanged", id, version }
//   -> 409 { status: "conflict", id, version, error }   (baseVersion is stale — rebase and retry)
//   -> 409 { status: "archived", id, version, error }   (the only row by that name is archived)
//   -> 403 { error, decision }                          (entitlement, named by src/lib/org/skill-write-gate.ts)
// The write half of the sync loop: register a skill by name, or update the existing one. Optimistic
// concurrency via `baseVersion` (the version the client last synced) means a stale local copy can't
// clobber a newer server edit. Write-gated (token skills:write or session) AND Team+ — the token is
// identity, not an entitlement bypass. `unchanged` (identical body) is idempotent: re-running never churns.
// The body must satisfy the frontmatter contract; a valid block wins over the request's name/category.

import { NextResponse } from "next/server";
import { isDbConfigured, pushOrgSkill, recordOrgAudit } from "@/lib/db";
import { authorizeOrgApi, isDenied, principalLogin } from "@/lib/api-token-auth";
import { skillWriteDenial, skillWriteGate } from "@/lib/org/skill-write-gate";
import { SKILL_CATEGORIES, isSkillCategory } from "@/lib/org/skill-categories";
import { reconcileSkillWrite } from "@/lib/org/skill-frontmatter";

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
  // The ONE entitlement decision, at the `push` door. This door's row says the personal-workspace free
  // path does NOT extend here (a declared exception, src/lib/org/skill-write-gate.ts), and the refusal
  // carries its decision NAME so a CLI can tell "your plan" from "this door is Team-only".
  const gate = await skillWriteGate(body.org, "push");
  if (!gate.allowed) {
    const denial = skillWriteDenial(gate);
    return NextResponse.json(denial.body, { status: denial.status });
  }

  // The pushed FILE is the source of truth: a declared frontmatter block must validate (400 with the
  // specific errors — a CLI push is exactly where a broken block should be caught) and its fields win
  // over the request's. A legacy file with no block is wrapped from the request fields.
  const fm = reconcileSkillWrite(body.content, {
    name: body.name,
    description: body.description,
    category: body.category,
    tags: Array.isArray(body.tags) ? body.tags : undefined,
  });
  if (!fm.ok) return NextResponse.json({ error: fm.errors[0], errors: fm.errors }, { status: 400 });

  const actorLogin = await principalLogin(auth.principal);
  const baseVersion = typeof body.baseVersion === "number" ? body.baseVersion : undefined;
  try {
    const result = await pushOrgSkill(
      body.org,
      {
        name: fm.fields.name,
        content: fm.content,
        category: fm.fields.category,
        description: fm.fields.description,
        tags: fm.fields.tags,
      },
      { baseVersion, createdBy: actorLogin },
    );
    if (!result) return NextResponse.json({ error: "Failed to push skill." }, { status: 500 });
    if (result.status === "archived") {
      return NextResponse.json(
        { ...result, error: `A skill named "${fm.fields.name}" is archived. Restore it before pushing.` },
        { status: 409 },
      );
    }
    if (result.status === "conflict") {
      return NextResponse.json(
        { ...result, error: `Server has version ${result.version}; you pushed against ${baseVersion}. Pull and retry.` },
        { status: 409 },
      );
    }
    if (result.status === "created" || result.status === "updated") {
      await recordOrgAudit(`org_skill.${result.status}`, body.org, { skillId: result.id, name: fm.fields.name, via: "push" }, actorLogin ?? undefined);
    }
    return NextResponse.json(result);
  } catch (err) {
    if ((err as { code?: string }).code === "P2002") {
      return NextResponse.json({ error: "A skill with that name already exists." }, { status: 409 });
    }
    return NextResponse.json({ error: "Failed to push skill." }, { status: 500 });
  }
}
