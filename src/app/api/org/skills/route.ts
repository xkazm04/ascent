// GET  /api/org/skills?org=&category=&search=&sort=  -> { skills, categories }   (read-gated)
// POST /api/org/skills { org, name, category, content, description?, tags? } -> { id }
// Org Skills Library (Feature 2). The list is read-gated (any member of the org); creating a skill is
// member-gated AND requires a Team+ plan (authoring is the gated capability; reads stay open — §8.6).
// The stored body must satisfy the frontmatter CONTRACT (src/lib/org/skill-frontmatter.ts): a declared
// block must validate (else 400 with the specific errors) and WINS over the request's columns; a body
// with no block is wrapped from them, so every stored skill is a conformant SKILL.md.

import { NextResponse } from "next/server";
import {
  createOrgSkill,
  getCreditState,
  isDbConfigured,
  listOrgSkills,
  personalSkillCapReached,
  workspaceAllowsSkills,
  PERSONAL_SKILL_LIMIT,
  type SkillSort,
} from "@/lib/db";
import { authorizeOrgApi, isDenied, principalLogin } from "@/lib/api-token-auth";
import { SKILL_CATEGORIES, isSkillCategory } from "@/lib/org/skill-categories";
import { reconcileSkillWrite } from "@/lib/org/skill-frontmatter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const isSort = (v: string | null): v is SkillSort => v === "name" || v === "recent" || v === "downloads";

export async function GET(request: Request) {
  if (!isDbConfigured()) return NextResponse.json({ error: "Skills require a database." }, { status: 503 });
  const url = new URL(request.url);
  const org = url.searchParams.get("org");
  if (!org) return NextResponse.json({ error: "Missing ?org." }, { status: 400 });
  const auth = await authorizeOrgApi(request, org, { scope: "skills:read", mode: "read" });
  if (isDenied(auth)) return auth.denied;
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
  const auth = await authorizeOrgApi(request, body.org, { scope: "skills:write", mode: "write" });
  if (isDenied(auth)) return auth.denied;
  // Entitlement: authoring an ORG's library is a Team-and-up feature (reads stay open to all members);
  // a PERSONAL workspace authors free-with-limits (individual tier, decision 4) — capped below. This
  // still applies to a `skills:write` token — the token supplies identity, not an entitlement bypass.
  const credit = await getCreditState(body.org).catch(() => null);
  if (!(await workspaceAllowsSkills(body.org, credit?.plan))) {
    return NextResponse.json({ error: "The Skills Library is a Team-plan feature." }, { status: 403 });
  }
  if (await personalSkillCapReached(body.org, credit?.plan)) {
    return NextResponse.json(
      { error: `Personal skills are capped at ${PERSONAL_SKILL_LIMIT}. Archive one to author another.` },
      { status: 402 },
    );
  }
  if (!isSkillCategory(body.category)) {
    return NextResponse.json({ error: `category must be one of: ${SKILL_CATEGORIES.join(", ")}.` }, { status: 400 });
  }
  // Frontmatter contract — validated AFTER the gates so an unauthorized caller learns nothing about it.
  const fm = reconcileSkillWrite(body.content, {
    name: body.name,
    description: body.description,
    category: body.category,
    tags: Array.isArray(body.tags) ? body.tags : undefined,
  });
  if (!fm.ok) {
    return NextResponse.json({ error: fm.errors[0], errors: fm.errors }, { status: 400 });
  }
  // The audit actor is the token label for a machine call, else the Supabase viewer (the dormant
  // custom-OAuth session is null under the ACTIVE Supabase wall).
  const actorLogin = await principalLogin(auth.principal);
  try {
    const created = await createOrgSkill(
      body.org,
      {
        name: fm.fields.name,
        category: fm.fields.category,
        content: fm.content,
        description: fm.fields.description,
        tags: fm.fields.tags,
      },
      actorLogin,
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
