// POST /api/org/segments/:id/repos { org, fullName, member }
// Tag (member=true) or untag (member=false) a repo into a segment. Org-scoped server-side so a
// caller can only touch their own tenant's segments/repos.

import { NextResponse } from "next/server";
import { isDbConfigured, setRepoSegment } from "@/lib/db";
import { getSession, isAuthConfigured } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!isDbConfigured()) return NextResponse.json({ error: "Segments require a database." }, { status: 503 });
  if (isAuthConfigured() && !(await getSession())) {
    return NextResponse.json({ error: "Sign in to edit segments." }, { status: 401 });
  }
  const { id } = await ctx.params;
  const body = (await request.json().catch(() => ({}))) as { org?: string; fullName?: string; member?: boolean };
  if (!body.org || !body.fullName) {
    return NextResponse.json({ error: "Provide { org, fullName, member }." }, { status: 400 });
  }
  const ok = await setRepoSegment(body.org, id, body.fullName, Boolean(body.member));
  if (!ok) return NextResponse.json({ error: "Unknown segment or repo for this org." }, { status: 404 });
  return NextResponse.json({ ok: true, fullName: body.fullName, member: Boolean(body.member) });
}
