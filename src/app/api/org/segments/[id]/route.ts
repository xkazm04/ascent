// PATCH  /api/org/segments/:id { name?, color? }  -> rename / recolor
// DELETE /api/org/segments/:id                     -> remove the segment and its memberships

import { NextResponse } from "next/server";
import { deleteSegment, getSegmentOrgSlug, recordOrgAudit, segmentInputError, updateSegment } from "@/lib/db";
import { requireOrgAccess, requireOrgRole } from "@/lib/authz";
import { resolveViewerLogin } from "@/lib/access";
import type { OrgRole } from "@/lib/db/members";
import { dbGuard } from "@/lib/api/orgPlan";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// DB + per-row tenant gate: the segment must exist and the caller must hold at least `min` in its org.
// PATCH (rename/recolor) is a member-level write; DELETE is destructive, so it requires admin.
// Returns the owning slug on success so the audit row uses the same org the gate resolved.
async function gate(id: string, min: OrgRole = "member"): Promise<{ org: string } | Response> {
  const guard = dbGuard("Segments");
  if (guard) return guard;
  const org = await getSegmentOrgSlug(id);
  if (!org) return NextResponse.json({ error: "Segment not found." }, { status: 404 });
  const denied = min === "member" ? await requireOrgAccess(org) : await requireOrgRole(org, min);
  if (denied) return denied;
  return { org };
}

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const gated = await gate(id);
  if (gated instanceof Response) return gated;
  const body = (await request.json().catch(() => ({}))) as { name?: unknown; color?: unknown };
  // repositories-segments #5: reject-with-400 instead of sanitize-and-continue — a PATCH with
  // { color: "rebeccapurple" } previously recolored the segment to the brand accent and returned
  // { ok: true }; a 61+-char rename was truncated with no signal. A non-string name or colour
  // used to throw inside that check and surface as a 500.
  const invalid = segmentInputError(body);
  if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });
  const data: { name?: string; color?: string | null } = {};
  if (typeof body.name === "string") data.name = body.name;
  if (typeof body.color === "string" || body.color === null) data.color = body.color;
  // A body with neither field still reached segment.update and wrote segment.updated
  // with an empty change list. There is nothing to store.
  if (data.name === undefined && data.color === undefined) {
    return NextResponse.json({ ok: true });
  }
  try {
    await updateSegment(id, data);
    const actorLogin = await resolveViewerLogin();
    const changed = Object.keys(body).filter((k) => body[k as keyof typeof body] !== undefined);
    await recordOrgAudit("segment.updated", gated.org, { segmentId: id, changed }, actorLogin ?? undefined);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if ((err as { code?: string }).code === "P2025") return NextResponse.json({ error: "Segment not found." }, { status: 404 });
    if ((err as { code?: string }).code === "P2002") return NextResponse.json({ error: "A segment with that name already exists." }, { status: 409 });
    console.error("[org/segments] update failed", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Failed to update segment." }, { status: 500 });
  }
}

export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const gated = await gate(id, "admin");
  if (gated instanceof Response) return gated;
  try {
    await deleteSegment(id);
    const actorLogin = await resolveViewerLogin();
    await recordOrgAudit("segment.deleted", gated.org, { segmentId: id }, actorLogin ?? undefined);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if ((err as { code?: string }).code === "P2025") return NextResponse.json({ error: "Segment not found." }, { status: 404 });
    console.error("[org/segments] delete failed", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Failed to delete segment." }, { status: 500 });
  }
}
