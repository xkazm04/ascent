// GET  /api/org/skills/:id/download -> the skill content as a markdown file download (+ counts a use)
// POST /api/org/skills/:id/download -> { ok }  counts a "use" (Copy for LLM) WITHOUT downloading (§8.7)
// Read-gated (any member may use a skill). The usage counter is fire-and-forget — it never blocks or
// fails the download/copy path. Both a download and a copy count as a "use" per §8.7.

import { NextResponse } from "next/server";
import { getOrgSkill, getOrgSkillOrgSlug, isDbConfigured, recordSkillDownload } from "@/lib/db";
import { requireOrgRead } from "@/lib/authz";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Safe download filename from a user-authored skill name — strips anything but [a-z0-9._-] so the
 *  value can't inject CRLF/quotes into the Content-Disposition header. Falls back to "skill". */
function safeFilename(name: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
  return `${base || "skill"}.SKILL.md`;
}

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!isDbConfigured()) return NextResponse.json({ error: "Skills require a database." }, { status: 503 });
  const { id } = await ctx.params;
  const org = await getOrgSkillOrgSlug(id);
  if (!org) return NextResponse.json({ error: "Skill not found." }, { status: 404 });
  const denied = await requireOrgRead(org);
  if (denied) return denied;
  const skill = await getOrgSkill(id);
  if (!skill) return NextResponse.json({ error: "Skill not found." }, { status: 404 });
  void recordSkillDownload(id); // fire-and-forget — must not block the download
  return new NextResponse(skill.content, {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "content-disposition": `attachment; filename="${safeFilename(skill.name)}"`,
    },
  });
}

export async function POST(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!isDbConfigured()) return NextResponse.json({ error: "Skills require a database." }, { status: 503 });
  const { id } = await ctx.params;
  const org = await getOrgSkillOrgSlug(id);
  if (!org) return NextResponse.json({ error: "Skill not found." }, { status: 404 });
  const denied = await requireOrgRead(org);
  if (denied) return denied;
  await recordSkillDownload(id);
  return NextResponse.json({ ok: true });
}
