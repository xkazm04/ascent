// PATCH  /api/org/segments/:id { name?, color? }  -> rename / recolor
// DELETE /api/org/segments/:id                     -> remove the segment and its memberships

import { NextResponse } from "next/server";
import { deleteSegment, isDbConfigured, updateSegment } from "@/lib/db";
import { getSession, isAuthConfigured } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function gate(): Promise<NextResponse | null> {
  if (!isDbConfigured()) return NextResponse.json({ error: "Segments require a database." }, { status: 503 });
  if (isAuthConfigured() && !(await getSession())) return NextResponse.json({ error: "Sign in to edit segments." }, { status: 401 });
  return null;
}

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const blocked = await gate();
  if (blocked) return blocked;
  const { id } = await ctx.params;
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
  const blocked = await gate();
  if (blocked) return blocked;
  const { id } = await ctx.params;
  try {
    await deleteSegment(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if ((err as { code?: string }).code === "P2025") return NextResponse.json({ error: "Segment not found." }, { status: 404 });
    return NextResponse.json({ error: "Failed to delete segment." }, { status: 500 });
  }
}
