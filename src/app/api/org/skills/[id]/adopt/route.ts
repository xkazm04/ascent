// POST   /api/org/skills/:id/adopt { repo } -> { ok }   mark a repo as having adopted the skill
// DELETE /api/org/skills/:id/adopt { repo } -> { ok }   unmark
// Member-gated (the explicit reuse signal — Feature 2 P2). Per-row org gate resolved FROM the skill;
// the org filter inside adoptOrgSkill is the tenant boundary (mirrors playbooks/[id]/repos).

import { NextResponse } from "next/server";
import { adoptOrgSkill, getOrgSkillOrgSlug, isDbConfigured, unadoptOrgSkill } from "@/lib/db";
import { requireOrgAccess } from "@/lib/authz";
import { getSession } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function resolve(id: string): Promise<{ org: string } | NextResponse> {
  if (!isDbConfigured()) return NextResponse.json({ error: "Skills require a database." }, { status: 503 });
  const org = await getOrgSkillOrgSlug(id);
  if (!org) return NextResponse.json({ error: "Skill not found." }, { status: 404 });
  const denied = await requireOrgAccess(org);
  if (denied) return denied;
  return { org };
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const r = await resolve(id);
  if (r instanceof Response) return r;
  const body = (await request.json().catch(() => ({}))) as { repo?: string };
  const repo = body.repo?.trim();
  if (!repo) return NextResponse.json({ error: "Provide { repo }." }, { status: 400 });
  const session = await getSession();
  const ok = await adoptOrgSkill(r.org, id, repo, session?.login ?? null);
  return NextResponse.json(ok ? { ok: true } : { error: "Skill not found." }, { status: ok ? 200 : 404 });
}

export async function DELETE(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const r = await resolve(id);
  if (r instanceof Response) return r;
  const body = (await request.json().catch(() => ({}))) as { repo?: string };
  const repo = body.repo?.trim();
  if (!repo) return NextResponse.json({ error: "Provide { repo }." }, { status: 400 });
  await unadoptOrgSkill(id, repo);
  return NextResponse.json({ ok: true });
}
