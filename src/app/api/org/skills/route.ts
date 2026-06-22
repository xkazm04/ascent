// GET  /api/org/skills?org=&category=&search=&sort=  -> { skills, categories }   (read-gated)
// POST /api/org/skills { org, name, category, content, description?, tags? } -> { id }
// Org Skills Library (Feature 2). The list is read-gated (any member of the org); creating a skill is
// member-gated AND requires a Team+ plan (authoring is the gated capability; reads stay open — §8.6).

import { NextResponse } from "next/server";
import { createOrgSkill, getCreditState, isDbConfigured, listOrgSkills, type SkillSort } from "@/lib/db";
import { requireOrgAccess, requireOrgRead } from "@/lib/authz";
import { getSession } from "@/lib/auth";
import { planAllowsSkillsLibrary } from "@/lib/plans";
import { SKILL_CATEGORIES, isSkillCategory } from "@/lib/org/skill-categories";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const isSort = (v: string | null): v is SkillSort => v === "name" || v === "recent" || v === "downloads";

export async function GET(request: Request) {
  if (!isDbConfigured()) return NextResponse.json({ error: "Skills require a database." }, { status: 503 });
  const url = new URL(request.url);
  const org = url.searchParams.get("org");
  if (!org) return NextResponse.json({ error: "Missing ?org." }, { status: 400 });
  const denied = await requireOrgRead(org);
  if (denied) return denied;
  const sortParam = url.searchParams.get("sort");
  const skills = await listOrgSkills(org, {
    category: url.searchParams.get("category") ?? undefined,
    search: url.searchParams.get("search") ?? undefined,
    sort: isSort(sortParam) ? sortParam : undefined,
  });
  return NextResponse.json({ skills: skills ?? [], categories: SKILL_CATEGORIES });
}

export async function POST(request: Request) {
  if (!isDbConfigured()) return NextResponse.json({ error: "Skills require a database." }, { status: 503 });
  const body = (await request.json().catch(() => ({}))) as {
    org?: string;
    name?: string;
    category?: string;
    content?: string;
    description?: string;
    tags?: string[];
  };
  if (!body.org || !body.name?.trim() || !body.content?.trim() || !body.category) {
    return NextResponse.json({ error: "Provide { org, name, category, content }." }, { status: 400 });
  }
  const denied = await requireOrgAccess(body.org);
  if (denied) return denied;
  // Entitlement: authoring the library is a Team-and-up feature (reads stay open to all members).
  const credit = await getCreditState(body.org).catch(() => null);
  if (!planAllowsSkillsLibrary(credit?.plan)) {
    return NextResponse.json({ error: "The Skills Library is a Team-plan feature." }, { status: 403 });
  }
  if (!isSkillCategory(body.category)) {
    return NextResponse.json({ error: `category must be one of: ${SKILL_CATEGORIES.join(", ")}.` }, { status: 400 });
  }
  const session = await getSession();
  try {
    const created = await createOrgSkill(
      body.org,
      {
        name: body.name,
        category: body.category,
        content: body.content,
        description: body.description,
        tags: Array.isArray(body.tags) ? body.tags : undefined,
      },
      session?.login ?? null,
    );
    return NextResponse.json(created ?? { error: "Failed to create skill." }, { status: created ? 200 : 500 });
  } catch (err) {
    // @@unique([orgId, name]) clash — a duplicate name in the same org.
    if ((err as { code?: string }).code === "P2002") {
      return NextResponse.json({ error: "A skill with that name already exists." }, { status: 409 });
    }
    return NextResponse.json({ error: "Failed to create skill." }, { status: 500 });
  }
}
