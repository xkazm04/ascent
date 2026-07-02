// PATCH  /api/org/playbooks/:id { title?, dimId?, summary?, steps?, archived? } -> { ok }
// DELETE /api/org/playbooks/:id                                                  -> { ok }
// Per-row org gate: the org is resolved from the playbook, then authorized. PATCH is member-level;
// DELETE is destructive, so it requires admin.

import { NextResponse } from "next/server";
import { deletePlaybook, isDbConfigured, recordOrgAudit, updatePlaybook } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { isDimensionId } from "@/lib/maturity/model";
import { resolvePlaybookOrg } from "@/lib/org/playbook-gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const body = (await request.json().catch(() => ({}))) as {
    title?: string;
    dimId?: string;
    summary?: string;
    steps?: string[];
    archived?: boolean;
  };
  // `archived` is a destructive soft-delete, not ordinary editable content: listPlaybooks hides
  // archived rows and there is no member-facing un-archive, so toggling it removes (or restores) an
  // org standard for everyone — the same outcome the hard DELETE guards. Require the SAME admin role
  // when the body touches `archived` (either direction); a plain content edit stays member-level.
  const min = body.archived !== undefined ? "admin" : "member";
  const gated = await resolvePlaybookOrg(id, min);
  if (gated instanceof Response) return gated;
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
    // Reuse the org the gate already resolved (no second getPlaybookOrgSlug round-trip).
    const session = await getSession();
    const changed = Object.keys(body).filter((k) => body[k as keyof typeof body] !== undefined);
    await recordOrgAudit("playbook.updated", gated.org, { playbookId: id, changed }, session?.login);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if ((err as { code?: string }).code === "P2025") return NextResponse.json({ error: "Playbook not found." }, { status: 404 });
    return NextResponse.json({ error: "Failed to update playbook." }, { status: 500 });
  }
}

export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const gated = await resolvePlaybookOrg(id, "admin");
  if (gated instanceof Response) return gated;
  try {
    await deletePlaybook(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if ((err as { code?: string }).code === "P2025") return NextResponse.json({ error: "Playbook not found." }, { status: 404 });
    return NextResponse.json({ error: "Failed to delete playbook." }, { status: 500 });
  }
}
