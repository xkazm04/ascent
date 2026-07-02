// POST /api/dev/seed-vercel-demo — DEV/DEMO ONLY. Rebrands the imported "vercel" org to "Vercel Demo"
// (slug vercel-demo) and populates the demo-only extras that scans don't produce — Segments, Skills,
// Goals + Initiatives (the Plan tab), and Members — so those tabs render populated. Runs IN the server
// process, so it reaches the in-process embedded PGlite (a standalone script can't while dev is up).
// Idempotent: re-running skips rows that already exist by their unique name/label/title.
//
// Gating mirrors /api/dev/seed-fleet: when ASCENT_SEED_SECRET is set the caller must present it
// (x-seed-secret header or ?secret=); with no secret it's allowed only outside production.
//
//   curl -X POST http://localhost:3001/api/dev/seed-vercel-demo
//
// Prereq: the org must already be imported (scripts/seed-org.mjs vercel) so its repos exist to tag.

import { NextResponse, type NextRequest } from "next/server";
import {
  createGoal,
  createInitiative,
  createOrgSkill,
  createSegment,
  getPrisma,
  isDbConfigured,
  setMembershipRole,
  setOrgPlan,
  setRepoSegmentsBulk,
} from "@/lib/db";
import { DEMO_ORG, GOALS, INITIATIVES, MEMBERS, SEGMENTS, SKILLS } from "./demo-data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

function authorized(req: NextRequest): boolean {
  const secret = process.env.ASCENT_SEED_SECRET?.trim();
  if (secret) {
    const provided = req.headers.get("x-seed-secret") ?? new URL(req.url).searchParams.get("secret");
    return provided === secret;
  }
  // No secret configured → allow only outside production, so a bare prod deploy can't be seeded by anyone.
  return process.env.NODE_ENV !== "production";
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json(
      { error: "forbidden — set ASCENT_SEED_SECRET and pass it via the x-seed-secret header or ?secret=" },
      { status: 403 },
    );
  }
  if (!isDbConfigured()) {
    return NextResponse.json({ error: "persistence is disabled — set DATABASE_URL (or DSQL_ENDPOINT) first" }, { status: 400 });
  }

  const prisma = getPrisma();
  const slug = DEMO_ORG.slug;

  // 1) Rebrand: "vercel" → "vercel-demo" / "Vercel Demo". updateMany is idempotent (0 rows on re-run);
  //    the second call re-asserts the display name whether we just renamed or it was already renamed.
  const renamed = await prisma.organization.updateMany({
    where: { slug: DEMO_ORG.fromSlug },
    data: { slug, name: DEMO_ORG.name },
  });
  await prisma.organization.updateMany({ where: { slug }, data: { name: DEMO_ORG.name } });
  const org = await prisma.organization.findUnique({ where: { slug }, select: { id: true } });
  if (!org) {
    return NextResponse.json(
      { error: `Org "${DEMO_ORG.fromSlug}"/"${slug}" not found — import it first: node scripts/seed-org.mjs vercel` },
      { status: 404 },
    );
  }

  // 2) Plan tier → team (so the Skills Library is a first-class, enabled feature in the demo).
  await setOrgPlan(slug, DEMO_ORG.plan);

  // 3) Segments (+ tag the org's real repos). Reuse a same-named segment on re-run; tagging is idempotent.
  const existingSegs = await prisma.segment.findMany({ where: { orgId: org.id }, select: { id: true, name: true } });
  const segIdByName = new Map(existingSegs.map((s) => [s.name, s.id]));
  let segmentsCreated = 0;
  let repoTags = 0;
  for (const s of SEGMENTS) {
    let id = segIdByName.get(s.name) ?? null;
    if (!id) {
      const created = await createSegment(slug, { name: s.name, color: s.color }).catch(() => null);
      id = created?.id ?? null;
      if (id) segmentsCreated++;
    }
    if (id) repoTags += Math.max(0, await setRepoSegmentsBulk(slug, id, s.repos, true));
  }

  // 4) Skills. createOrgSkill throws P2002 on a duplicate name within the org → treat as already-seeded.
  let skillsCreated = 0;
  for (const sk of SKILLS) {
    const created = await createOrgSkill(
      slug,
      { name: sk.name, category: sk.category, content: sk.content, description: sk.description, tags: sk.tags },
      "leerob",
    ).catch(() => null);
    if (created) skillsCreated++;
  }

  // 5) Goals (idempotent by label). Track metric → goalId so an initiative can link to its steering goal.
  const existingGoals = await prisma.goal.findMany({ where: { orgId: org.id }, select: { id: true, label: true, metric: true } });
  const goalIdByMetric = new Map(existingGoals.map((g) => [g.metric, g.id]));
  const existingGoalLabels = new Set(existingGoals.map((g) => g.label));
  let goalsCreated = 0;
  for (const g of GOALS) {
    if (existingGoalLabels.has(g.label)) continue;
    const created = await createGoal(slug, g).catch(() => null);
    if (created) {
      goalsCreated++;
      goalIdByMetric.set(g.metric, created.id);
    }
  }

  // 6) Initiatives (idempotent by title), linked to the steering goal on the same metric when present.
  const existingInits = await prisma.initiative.findMany({ where: { orgId: org.id }, select: { title: true } });
  const existingTitles = new Set(existingInits.map((i) => i.title));
  let initiativesCreated = 0;
  for (const i of INITIATIVES) {
    if (existingTitles.has(i.title)) continue;
    const goalId = i.linkGoalMetric ? goalIdByMetric.get(i.linkGoalMetric) ?? null : null;
    const created = await createInitiative(slug, {
      title: i.title,
      dimId: i.dimId,
      repos: i.repos,
      targetScore: i.targetScore,
      goalId,
    }).catch(() => null);
    if (created) initiativesCreated++;
  }

  // 7) Members (+ display names). setMembershipRole upserts the User + Membership idempotently.
  let membersSet = 0;
  for (const m of MEMBERS) {
    const outcome = await setMembershipRole(slug, m.login, m.role);
    if (outcome !== "ok") continue;
    membersSet++;
    await prisma.user.update({ where: { githubLogin: m.login.toLowerCase() }, data: { name: m.name } }).catch(() => {});
  }

  return NextResponse.json({
    ok: true,
    org: { slug, name: DEMO_ORG.name, renamedFrom: renamed.count > 0 ? DEMO_ORG.fromSlug : null, plan: DEMO_ORG.plan },
    seeded: { segmentsCreated, repoTags, skillsCreated, goalsCreated, initiativesCreated, membersSet },
    view: {
      dashboard: `/org/${slug}`,
      segments: `/org/${slug}/segments`,
      skills: `/org/${slug}/skills`,
      plan: `/org/${slug}/plan`,
      members: `/org/${slug}/members`,
    },
  });
}
