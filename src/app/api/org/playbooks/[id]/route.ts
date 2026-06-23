// PATCH  /api/org/playbooks/:id { title?, dimId?, summary?, steps?, archived? } -> { ok }
// DELETE /api/org/playbooks/:id                                                  -> { ok }
// Per-row org gate: the org is resolved from the playbook, then authorized. PATCH is member-level;
// DELETE is destructive, so it requires admin.

import { NextResponse } from "next/server";
import { deletePlaybook, getOrgId, getPlaybookOrgSlug, isDbConfigured, recordAudit, updatePlaybook } from "@/lib/db";
import { requireOrgAccess, requireOrgRole } from "@/lib/authz";
import { getSession } from "@/lib/auth";
import { isDimensionId } from "@/lib/maturity/model";
import type { OrgRole } from "@/lib/db/members";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function gate(id: string, min: OrgRole = "member"): Promise<NextResponse | null> {
  if (!isDbConfigured()) return NextResponse.json({ error: "Playbooks require a database." }, { status: 503 });
  const org = await getPlaybookOrgSlug(id);
  if (!org) return NextResponse.json({ error: "Playbook not found." }, { status: 404 });
  return min === "member" ? requireOrgAccess(org) : requireOrgRole(org, min);
}

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const blocked = await gate(id);
  if (blocked) return blocked;
  const body = (await request.json().catch(() => ({}))) as {
    title?: string;
    dimId?: string;
    summary?: string;
    steps?: string[];
    archived?: boolean;
  };
  if (body.dimId !== undefined && !isDimensionId(body.dimId)) {
    return NextResponse.json({ error: "dimId must be D1..D9." }, { status: 400 });
  }
  try {
    await updatePlaybook(id, {
      title: body.title,
      dimId: body.dimId,
      summary: body.summary,
      steps: Array.isArray(body.steps) ? body.steps : undefined,
      archived: body.archived,
    });
    // PLAY-6: audit the change so a playbook edit leaves a trail (the org's standards have history).
    const org = await getPlaybookOrgSlug(id);
    const session = await getSession();
    const orgId = org ? (await getOrgId(org.toLowerCase()).catch(() => null)) ?? undefined : undefined;
    const changed = Object.keys(body).filter((k) => body[k as keyof typeof body] !== undefined);
    await recordAudit("playbook.updated", { playbookId: id, changed }, { orgId, actorId: session?.login });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if ((err as { code?: string }).code === "P2025") return NextResponse.json({ error: "Playbook not found." }, { status: 404 });
    return NextResponse.json({ error: "Failed to update playbook." }, { status: 500 });
  }
}

export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const blocked = await gate(id, "admin");
  if (blocked) return blocked;
  try {
    await deletePlaybook(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if ((err as { code?: string }).code === "P2025") return NextResponse.json({ error: "Playbook not found." }, { status: 404 });
    return NextResponse.json({ error: "Failed to delete playbook." }, { status: 500 });
  }
}
