// PATCH  /api/org/segments/:id { name?, color? }  -> rename / recolor
// DELETE /api/org/segments/:id                     -> remove the segment and its memberships

import { NextResponse } from "next/server";
import { deleteSegment, getSegmentOrgSlug, isDbConfigured, updateSegment } from "@/lib/db";
import { requireOrgAccess, requireOrgRole } from "@/lib/authz";
import type { OrgRole } from "@/lib/db/members";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// DB + per-row tenant gate: the segment must exist and the caller must hold at least `min` in its org.
// PATCH (rename/recolor) is a member-level write; DELETE is destructive, so it requires admin.
async function gate(id: string, min: OrgRole = "member"): Promise<NextResponse | null> {
  if (!isDbConfigured()) return NextResponse.json({ error: "Segments require a database." }, { status: 503 });
  const org = await getSegmentOrgSlug(id);
  if (!org) return NextResponse.json({ error: "Segment not found." }, { status: 404 });
  return min === "member" ? requireOrgAccess(org) : requireOrgRole(org, min);
}

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const blocked = await gate(id);
  if (blocked) return blocked;
  const body = (await request.json().catch(() => ({}))) as { name?: string; color?: string };
  try {
    await updateSegment(id, body);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if ((err as { code?: string }).code === "P2025") return NextResponse.json({ error: "Segment not found." }, { status: 404 });
    if ((err as { code?: string }).code === "P2002") return NextResponse.json({ error: "A segment with that name already exists." }, { status: 409 });
    return NextResponse.json({ error: "Failed to update segment." }, { status: 500 });
  }
}

export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const blocked = await gate(id, "admin");
  if (blocked) return blocked;
  try {
    await deleteSegment(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if ((err as { code?: string }).code === "P2025") return NextResponse.json({ error: "Segment not found." }, { status: 404 });
    return NextResponse.json({ error: "Failed to delete segment." }, { status: 500 });
  }
}
