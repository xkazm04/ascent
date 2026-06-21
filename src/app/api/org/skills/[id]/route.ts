// GET    /api/org/skills/:id                            -> { skill }   (read-gated)
// PATCH  /api/org/skills/:id { name?, description?, content?, category?, tags?, archived? } -> { ok }
// DELETE /api/org/skills/:id                            -> { ok }      (admin · soft-archive)
// Per-row org gate: the owning org is resolved FROM the skill (getOrgSkillOrgSlug), then authorized.
// PATCH is member-level + Team+; DELETE is destructive (admin) + Team+ and soft-archives (never a hard
// delete, so adoption history survives). Mirrors the playbooks [id] route + the branding plan-gate.

import { NextResponse } from "next/server";
import {
  archiveOrgSkill,
  getCreditState,
  getOrgId,
  getOrgSkill,
  getOrgSkillOrgSlug,
  isDbConfigured,
  recordAudit,
  updateOrgSkill,
} from "@/lib/db";
import { requireOrgAccess, requireOrgRead, requireOrgRole } from "@/lib/authz";
import { getSession } from "@/lib/auth";
import { planAllowsSkillsLibrary } from "@/lib/plans";
import { SKILL_CATEGORIES, isSkillCategory } from "@/lib/org/skill-categories";
import type { OrgRole } from "@/lib/db/members";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Resolve+authorize the skill's owning org for a write. Returns the org slug, or a NextResponse to
 *  send back (503 no-db / 404 unknown / gate 401-403 / 403 plan). Reads use requireOrgRead inline. */
async function gateWrite(id: string, min: OrgRole): Promise<{ org: string } | NextResponse> {
  if (!isDbConfigured()) return NextResponse.json({ error: "Skills require a database." }, { status: 503 });
  const org = await getOrgSkillOrgSlug(id);
  if (!org) return NextResponse.json({ error: "Skill not found." }, { status: 404 });
  const denied = min === "member" ? await requireOrgAccess(org) : await requireOrgRole(org, min);
  if (denied) return denied;
  const credit = await getCreditState(org).catch(() => null);
  if (!planAllowsSkillsLibrary(credit?.plan)) {
    return NextResponse.json({ error: "The Skills Library is a Team-plan feature." }, { status: 403 });
  }
  return { org };
}

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!isDbConfigured()) return NextResponse.json({ error: "Skills require a database." }, { status: 503 });
  const { id } = await ctx.params;
  const org = await getOrgSkillOrgSlug(id);
  if (!org) return NextResponse.json({ error: "Skill not found." }, { status: 404 });
  const denied = await requireOrgRead(org);
  if (denied) return denied;
  const skill = await getOrgSkill(id);
  if (!skill) return NextResponse.json({ error: "Skill not found." }, { status: 404 });
  return NextResponse.json({ skill });
}

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await gateWrite(id, "member");
  if (g instanceof Response) return g;
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
    const session = await getSession();
    const orgId = (await getOrgId(g.org.toLowerCase()).catch(() => null)) ?? undefined;
    const changed = Object.keys(body).filter((k) => body[k as keyof typeof body] !== undefined);
    await recordAudit("org_skill.updated", { skillId: id, changed }, { orgId, actorId: session?.login });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "P2025") return NextResponse.json({ error: "Skill not found." }, { status: 404 });
    if (code === "P2002") return NextResponse.json({ error: "A skill with that name already exists." }, { status: 409 });
    return NextResponse.json({ error: "Failed to update skill." }, { status: 500 });
  }
}

export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const g = await gateWrite(id, "admin");
  if (g instanceof Response) return g;
  try {
    await archiveOrgSkill(id);
    const session = await getSession();
    const orgId = (await getOrgId(g.org.toLowerCase()).catch(() => null)) ?? undefined;
    await recordAudit("org_skill.archived", { skillId: id }, { orgId, actorId: session?.login });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if ((err as { code?: string }).code === "P2025") return NextResponse.json({ error: "Skill not found." }, { status: 404 });
    return NextResponse.json({ error: "Failed to archive skill." }, { status: 500 });
  }
}
