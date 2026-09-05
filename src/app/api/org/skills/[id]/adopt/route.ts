// POST   /api/org/skills/:id/adopt { repo } -> { ok }   mark a repo as having adopted the skill
// DELETE /api/org/skills/:id/adopt { repo } -> { ok }   unmark
// Member-gated (the explicit reuse signal — Feature 2 P2). Per-row org gate resolved FROM the skill;
// the org filter inside adoptOrgSkill AND unadoptOrgSkill is the tenant boundary (mirrors
// playbooks/[id]/repos). DELETE stays idempotent (200 + `removed`); see the note on it.

import { NextResponse } from "next/server";
import { adoptOrgSkill, getOrgSkillOrgSlug, isDbConfigured, unadoptOrgSkill } from "@/lib/db";
import { requireOrgAccess } from "@/lib/authz";
import { resolveViewerLogin } from "@/lib/access";

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
  // resolveViewerLogin, not the dormant session: the custom-OAuth session is null under the ACTIVE
  // Supabase wall, so this actor/audit row was recorded as null in production.
  const actorLogin = await resolveViewerLogin();
  const ok = await adoptOrgSkill(r.org, id, repo, actorLogin);
  return NextResponse.json(ok ? { ok: true } : { error: "Skill not found." }, { status: ok ? 200 : 404 });
}

export async function DELETE(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const r = await resolve(id);
  if (r instanceof Response) return r;
  const body = (await request.json().catch(() => ({}))) as { repo?: string };
  const repo = body.repo?.trim();
  if (!repo) return NextResponse.json({ error: "Provide { repo }." }, { status: 400 });
  const removed = await unadoptOrgSkill(r.org, id, repo);
  // 200 EVEN WHEN NOTHING MATCHED, deliberately — a DELETE is idempotent and the caller's goal state
  // ("this repo does not have this skill") holds either way. A 404 here would be symmetric with POST
  // and wrong: SkillCard.unadopt rolls its optimistic removal BACK on !res.ok, so a second click, or a
  // colleague having unadopted first, would restore a chip for an adoption the DB does not have — the
  // exact failure the adopt path's rollback exists to prevent, inverted. `removed` carries the fact
  // for a caller that wants it.
  return NextResponse.json({ ok: true, removed });
}
