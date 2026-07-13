// GET    /api/org/skills/:id                            -> { skill }   (read-gated; token-aware)
// PATCH  /api/org/skills/:id { name?, description?, content?, category?, tags?, archived? } -> { ok }
// DELETE /api/org/skills/:id                            -> { ok }      (admin · soft-archive · SESSION only)
// Per-row org gate: the owning org is resolved FROM the skill (getOrgSkillOrgSlug), then authorized.
// GET/PATCH accept an `askl_` bearer (skills:read / skills:write) OR a session; PATCH is member-level +
// Team+. DELETE is destructive (admin) and stays SESSION-only — a machine token never hard-archives.

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
import { planAllowsSkillsLibrary } from "@/lib/plans";
import { SKILL_CATEGORIES, isSkillCategory } from "@/lib/org/skill-categories";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Plan gate shared by write paths — authoring the library is a Team-and-up feature. */
async function planDenied(org: string): Promise<NextResponse | null> {
  const credit = await getCreditState(org).catch(() => null);
  if (!planAllowsSkillsLibrary(credit?.plan)) {
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
  try {
    await updateOrgSkill(id, {
      name: body.name,
      description: body.description,
      content: body.content,
      category: body.category,
      tags: Array.isArray(body.tags) ? body.tags : undefined,
      archived: body.archived,
    });
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
