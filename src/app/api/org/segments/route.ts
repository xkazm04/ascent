// GET  /api/org/segments?org=slug                 -> { segments: SegmentRow[] }
// POST /api/org/segments { org, name, color? }     -> { id }
// User-defined slices of the fleet (platform, mobile, legacy, …). Every org aggregate accepts an
// optional segment filter scoping it to a segment's tagged repos. See src/lib/db/segments.ts.

import { NextResponse } from "next/server";
import { createSegment, isDbConfigured, listSegments } from "@/lib/db";
import { getSession, isAuthConfigured } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isDbConfigured()) return NextResponse.json({ error: "Segments require a database." }, { status: 503 });
  const org = new URL(request.url).searchParams.get("org");
  if (!org) return NextResponse.json({ error: "Missing ?org." }, { status: 400 });
  const segments = await listSegments(org);
  return NextResponse.json({ segments: segments ?? [] });
}

export async function POST(request: Request) {
  if (!isDbConfigured()) return NextResponse.json({ error: "Segments require a database." }, { status: 503 });
  if (isAuthConfigured() && !(await getSession())) {
    return NextResponse.json({ error: "Sign in to create a segment." }, { status: 401 });
  }
  const body = (await request.json().catch(() => ({}))) as { org?: string; name?: string; color?: string };
  if (!body.org || !body.name?.trim()) {
    return NextResponse.json({ error: "Provide { org, name }." }, { status: 400 });
  }
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
