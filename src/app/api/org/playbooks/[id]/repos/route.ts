// POST   /api/org/playbooks/:id/repos { repo } -> mark a repo as having applied this playbook
// DELETE /api/org/playbooks/:id/repos { repo } -> unmark it
// The org is resolved from the playbook (per-row gate); member-level access. Feeds adoption analytics.

import { NextResponse } from "next/server";
import { applyPlaybook, getPlaybookOrgSlug, isDbConfigured, unapplyPlaybook } from "@/lib/db";
import { requireOrgAccess } from "@/lib/authz";
import { getSession } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Resolve the owning org from the playbook id and authorize the caller against it. */
async function resolveAndGate(id: string): Promise<{ org: string } | NextResponse> {
  if (!isDbConfigured()) return NextResponse.json({ error: "Playbooks require a database." }, { status: 503 });
  const org = await getPlaybookOrgSlug(id);
  if (!org) return NextResponse.json({ error: "Playbook not found." }, { status: 404 });
  const denied = await requireOrgAccess(org);
  if (denied) return denied;
  return { org };
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = (await request.json().catch(() => ({}))) as { repo?: string };
  if (!body.repo?.trim()) return NextResponse.json({ error: "Provide { repo }." }, { status: 400 });
  const gated = await resolveAndGate(id);
  if (gated instanceof NextResponse) return gated;
  const session = await getSession();
  const ok = await applyPlaybook(gated.org, id, body.repo.trim(), session?.login ?? null);
  if (!ok) return NextResponse.json({ error: "Unknown playbook for this org." }, { status: 404 });
  return NextResponse.json({ ok: true, repo: body.repo.trim() });
}

export async function DELETE(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = (await request.json().catch(() => ({}))) as { repo?: string };
  if (!body.repo?.trim()) return NextResponse.json({ error: "Provide { repo }." }, { status: 400 });
  const gated = await resolveAndGate(id);
  if (gated instanceof NextResponse) return gated;
  await unapplyPlaybook(id, body.repo.trim());
  return NextResponse.json({ ok: true });
}
