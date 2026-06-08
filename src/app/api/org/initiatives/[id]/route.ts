// PATCH /api/org/initiatives/:id { status }  -> { ok }
// Move an initiative through open | in_progress | done | dismissed.

import { NextResponse } from "next/server";
import { getInitiativeOrgSlug, isDbConfigured, updateInitiativeStatus } from "@/lib/db";
import { requireOrgAccess } from "@/lib/authz";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUSES = new Set(["open", "in_progress", "done", "dismissed"]);

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!isDbConfigured()) return NextResponse.json({ error: "Initiatives require a database." }, { status: 503 });
  const { id } = await ctx.params;
  const org = await getInitiativeOrgSlug(id);
  if (!org) return NextResponse.json({ error: "Initiative not found." }, { status: 404 });
  const denied = await requireOrgAccess(org);
  if (denied) return denied;
  const body = (await request.json().catch(() => ({}))) as { status?: string };
  if (!body.status || !STATUSES.has(body.status)) {
    return NextResponse.json({ error: `status must be one of: ${[...STATUSES].join(", ")}.` }, { status: 400 });
  }
  try {
    await updateInitiativeStatus(id, body.status);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if ((err as { code?: string }).code === "P2025") return NextResponse.json({ error: "Initiative not found." }, { status: 404 });
    return NextResponse.json({ error: "Failed to update initiative." }, { status: 500 });
  }
}
