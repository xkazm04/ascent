// GET /api/org/skills/manifest?org=  -> { skills: [{ id, name, category, version, contentHash, updatedAt }] }
// The lightweight sync index: a client diffs this against its local lockfile (skill id -> version) and
// only downloads the skills whose version/contentHash changed. Read-gated and token-aware (an `askl_`
// bearer with skills:read, or a browser session). No bodies here — that's what /:id/download is for.

import { NextResponse } from "next/server";
import { isDbConfigured, listOrgSkillManifest } from "@/lib/db";
import { authorizeOrgApi, isDenied } from "@/lib/api-token-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isDbConfigured()) return NextResponse.json({ error: "Skills require a database." }, { status: 503 });
  const org = new URL(request.url).searchParams.get("org");
  if (!org) return NextResponse.json({ error: "Missing ?org." }, { status: 400 });
  const auth = await authorizeOrgApi(request, org, { scope: "skills:read", mode: "read" });
  if (isDenied(auth)) return auth.denied;
  return NextResponse.json({ skills: (await listOrgSkillManifest(org)) ?? [] });
}
