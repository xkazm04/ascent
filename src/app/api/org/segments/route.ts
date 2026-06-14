// GET  /api/org/segments?org=slug                 -> { segments: SegmentRow[] }
// POST /api/org/segments { org, name, color? }     -> { id }
// User-defined slices of the fleet (platform, mobile, legacy, …). Every org aggregate accepts an
// optional segment filter scoping it to a segment's tagged repos. See src/lib/db/segments.ts.

import { NextResponse } from "next/server";
import { createSegment, getRepoSegmentMap, isDbConfigured, listSegments } from "@/lib/db";
import { requireOrgAccess, requireOrgRead } from "@/lib/authz";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isDbConfigured()) return NextResponse.json({ error: "Segments require a database." }, { status: 503 });
  const { searchParams } = new URL(request.url);
  const org = searchParams.get("org");
  if (!org) return NextResponse.json({ error: "Missing ?org." }, { status: 400 });
  const denied = await requireOrgRead(org);
  if (denied) return denied;
  const segments = (await listSegments(org)) ?? [];
  // ?membership=1 also returns fullName → tagged segment ids, so a client (the connect screen) can
  // render a per-repo segment picker without a second round-trip.
  if (searchParams.get("membership") === "1") {
    const map = await getRepoSegmentMap(org);
    const membership: Record<string, string[]> = {};
    for (const [fullName, segs] of Object.entries(map)) membership[fullName] = segs.map((s) => s.id);
    return NextResponse.json({ segments, membership });
  }
  return NextResponse.json({ segments });
}

export async function POST(request: Request) {
  if (!isDbConfigured()) return NextResponse.json({ error: "Segments require a database." }, { status: 503 });
  const body = (await request.json().catch(() => ({}))) as { org?: string; name?: string; color?: string };
  if (!body.org || !body.name?.trim()) {
    return NextResponse.json({ error: "Provide { org, name }." }, { status: 400 });
  }
  const denied = await requireOrgAccess(body.org);
  if (denied) return denied;
  try {
    const created = await createSegment(body.org, { name: body.name, color: body.color });
    return NextResponse.json(created ?? { error: "Failed to create segment." }, { status: created ? 200 : 500 });
  } catch (err) {
    if ((err as { code?: string }).code === "P2002") {
      return NextResponse.json({ error: "A segment with that name already exists." }, { status: 409 });
    }
    return NextResponse.json({ error: "Failed to create segment." }, { status: 500 });
  }
}
