// POST /api/org/memory/:id/recall -> { ok }
//
// Bumps a memory's `accessCount` — the "this memory earned its keep" tally that powers the
// sort-by-recalls view and is the pruning signal a future consolidation job reads (design doc §3
// `access_count`, §8 "prunes redundant ones"). Fired when a member copies a memory for their LLM.
//
// Read-gated (any member of the owning org): recalling is a READ of the memory, not a write to the
// library. Best-effort by contract — recordMemoryRecall swallows its own errors, and this route answers
// ok:true regardless, so a counter can never break the copy it decorates. Mirrors the skills download
// counter (/api/org/skills/:id/download).

import { NextResponse } from "next/server";
import { getOrgMemoryOrgSlug, isDbConfigured, recordMemoryRecall } from "@/lib/db";
import { requireOrgRead } from "@/lib/authz";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!isDbConfigured()) return NextResponse.json({ error: "Memory requires a database." }, { status: 503 });
  const { id } = await ctx.params;
  const org = await getOrgMemoryOrgSlug(id);
  if (!org) return NextResponse.json({ error: "Memory not found." }, { status: 404 });
  const denied = await requireOrgRead(org);
  if (denied) return denied;
  await recordMemoryRecall(id);
  return NextResponse.json({ ok: true });
}
