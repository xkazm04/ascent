// GET    /api/org/skills/:id                            -> { skill }   (read-gated; token-aware)
// PATCH  /api/org/skills/:id { name?, description?, content?, category?, tags?, archived? } -> { ok }
// DELETE /api/org/skills/:id                            -> { ok }      (admin · soft-archive · SESSION only)
// Per-row org gate: the owning org is resolved FROM the skill (getOrgSkillOrgSlug), then authorized.
// GET/PATCH accept an `askl_` bearer (skills:read / skills:write) OR a session; PATCH is member-level +
// Team+. DELETE is destructive (admin) and stays SESSION-only — a machine token never hard-archives.
// A PATCH that touches `content` re-validates the frontmatter contract (400 + the specific errors when
// a declared block is broken) and syncs name/description/category/tags FROM it.

import { NextResponse } from "next/server";
import {
  archiveOrgSkill,
  getCreditState,
  getOrgSkill,
  getOrgSkillOrgSlug,
  isDbConfigured,
  recordOrgAudit,
  updateOrgSkill,
} from "@/lib/db";
import { requireOrgRole } from "@/lib/authz";
import { authorizeOrgApi, isDenied, principalLogin, type OrgApiPrincipal } from "@/lib/api-token-auth";
import { resolveViewerLogin } from "@/lib/access";
import { workspaceAllowsSkills } from "@/lib/db";
import { SKILL_CATEGORIES, isSkillCategory } from "@/lib/org/skill-categories";
import { reconcileSkillWrite } from "@/lib/org/skill-frontmatter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Plan gate shared by write paths — authoring the library is a Team-and-up feature. */
async function planDenied(org: string): Promise<NextResponse | null> {
  const credit = await getCreditState(org).catch(() => null);
  // Team+ orgs, or a personal workspace (free-with-limits — edits/archives don't grow the library).
  if (!(await workspaceAllowsSkills(org, credit?.plan))) {
    return NextResponse.json({ error: "The Skills Library is a Team-plan feature." }, { status: 403 });
  }
  return null;
}

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!isDbConfigured()) return NextResponse.json({ error: "Skills require a database." }, { status: 503 });
  const { id } = await ctx.params;
  const org = await getOrgSkillOrgSlug(id);
  if (!org) return NextResponse.json({ error: "Skill not found." }, { status: 404 });
  const auth = await authorizeOrgApi(request, org, { scope: "skills:read", mode: "read" });
  if (isDenied(auth)) return auth.denied;
  const skill = await getOrgSkill(id);
  if (!skill) return NextResponse.json({ error: "Skill not found." }, { status: 404 });
  return NextResponse.json({ skill });
}

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!isDbConfigured()) return NextResponse.json({ error: "Skills require a database." }, { status: 503 });
  const { id } = await ctx.params;
  const org = await getOrgSkillOrgSlug(id);
  if (!org) return NextResponse.json({ error: "Skill not found." }, { status: 404 });
  const auth = await authorizeOrgApi(request, org, { scope: "skills:write", mode: "write" });
  if (isDenied(auth)) return auth.denied;
  const planGate = await planDenied(org);
  if (planGate) return planGate;

  const body = (await request.json().catch(() => ({}))) as {
    name?: string;
    description?: string;
    content?: string;
    category?: string;
    tags?: string[];
    archived?: boolean;
  };
  if (body.category !== undefined && !isSkillCategory(body.category)) {
    return NextResponse.json({ error: `category must be one of: ${SKILL_CATEGORIES.join(", ")}.` }, { status: 400 });
  }
  const patch: Parameters<typeof updateOrgSkill>[1] = {
    name: body.name,
    description: body.description,
    content: body.content,
    category: body.category,
    tags: Array.isArray(body.tags) ? body.tags : undefined,
    archived: body.archived,
  };
  // A CONTENT edit re-runs the frontmatter contract. Anything the patch omits falls back to the stored
  // row, so editing only the body still resolves a full contract — and the block, once valid, WINS: the
  // name/description/category columns are synced from it rather than left disagreeing with the file.
  if (body.content !== undefined) {
    const current = await getOrgSkill(id);
    const fm = reconcileSkillWrite(body.content, {
      name: body.name ?? current?.name,
      description: body.description ?? current?.description,
      category: body.category ?? current?.category,
      tags: patch.tags ?? current?.tags,
    });
    if (!fm.ok) return NextResponse.json({ error: fm.errors[0], errors: fm.errors }, { status: 400 });
    patch.content = fm.content;
    patch.name = fm.fields.name;
    patch.description = fm.fields.description;
    patch.category = fm.fields.category;
    patch.tags = fm.fields.tags;
  }
  try {
    await updateOrgSkill(id, patch);
    const actorLogin = await principalLogin(auth.principal as OrgApiPrincipal);
    const changed = Object.keys(body).filter((k) => body[k as keyof typeof body] !== undefined);
    await recordOrgAudit("org_skill.updated", org, { skillId: id, changed }, actorLogin ?? undefined);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "P2025") return NextResponse.json({ error: "Skill not found." }, { status: 404 });
    if (code === "P2002") return NextResponse.json({ error: "A skill with that name already exists." }, { status: 409 });
    return NextResponse.json({ error: "Failed to update skill." }, { status: 500 });
  }
}

export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!isDbConfigured()) return NextResponse.json({ error: "Skills require a database." }, { status: 503 });
  const { id } = await ctx.params;
  const org = await getOrgSkillOrgSlug(id);
  if (!org) return NextResponse.json({ error: "Skill not found." }, { status: 404 });
  // Destructive: session + admin only (no token path) — a machine credential never archives a skill.
  const denied = await requireOrgRole(org, "admin");
  if (denied) return denied;
  const planGate = await planDenied(org);
  if (planGate) return planGate;
  try {
    await archiveOrgSkill(id);
    const actorLogin = await resolveViewerLogin();
    await recordOrgAudit("org_skill.archived", org, { skillId: id }, actorLogin ?? undefined);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if ((err as { code?: string }).code === "P2025") return NextResponse.json({ error: "Skill not found." }, { status: 404 });
    return NextResponse.json({ error: "Failed to archive skill." }, { status: 500 });
  }
}
