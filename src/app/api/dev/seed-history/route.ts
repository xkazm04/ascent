// POST /api/dev/seed-history — DEV/DEMO ONLY. Back-fills MULTI-SCAN history for an org's EXISTING
// watched repos so the fleet-evolution timetable has real columns to render. seed-org/import gives
// one scan per repo (persistScanReport dedups by head), so a freshly-imported org is a single column.
// For each repo this generates N back-dated scans (distinct deterministic SHAs → no dedup) trending
// gently UP to the repo's CURRENT overall, anchored ~1 week back so the real latest scan stays the
// newest column. Idempotent: the SHAs derive from (repo, index), so re-running dedups instead of piling.
//
// Gating mirrors /api/dev/seed-fleet: with ASCENT_SEED_SECRET set the caller must present it; with no
// secret it's allowed only outside production.
//
//   curl -X POST http://localhost:3000/api/dev/seed-history -d '{"org":"vercel"}'

import { NextResponse, type NextRequest } from "next/server";
import { getPrisma, isDbConfigured, persistScanReport } from "@/lib/db";
import { reportsForRepo } from "@/lib/dev/fleet-seed";
import type { RepoArchetype } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

function authorized(req: NextRequest): boolean {
  const secret = process.env.ASCENT_SEED_SECRET?.trim();
  if (secret) {
    const provided = req.headers.get("x-seed-secret") ?? new URL(req.url).searchParams.get("secret");
    return provided === secret;
  }
  return process.env.NODE_ENV !== "production";
}

function clampInt(v: unknown, dflt: number, min: number, max: number): number {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : dflt;
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: "forbidden: set ASCENT_SEED_SECRET and pass it via x-seed-secret or ?secret=" }, { status: 403 });
  }
  if (!isDbConfigured()) {
    return NextResponse.json({ error: "persistence is disabled: set DATABASE_URL first" }, { status: 400 });
  }
  const body = (await req.json().catch(() => ({}))) as { org?: string; scansPerRepo?: number; weeksBack?: number };
  const slug = (body.org ?? "vercel").toString().toLowerCase();
  const scansPerRepo = clampInt(body.scansPerRepo, 6, 2, 12);
  const weeksBack = clampInt(body.weeksBack, 10, 2, 52);

  const prisma = getPrisma();
  const org = await prisma.organization.findUnique({ where: { slug }, select: { id: true } });
  if (!org) return NextResponse.json({ error: `org "${slug}" not found: import it first` }, { status: 404 });

  const repos = await prisma.repository.findMany({
    where: { orgId: org.id, watched: true },
    select: {
      owner: true,
      name: true,
      primaryLanguage: true,
      scans: { orderBy: { scannedAt: "desc" }, take: 1, select: { overallScore: true } },
    },
  });

  // Newest seeded scan ~1 week ago so today's real scan stays the authoritative newest column.
  const anchor = Date.now() - 7 * 86_400_000;
  let scansPersisted = 0;
  for (const r of repos) {
    const target = r.scans[0]?.overallScore ?? 55;
    const spec = {
      owner: r.owner,
      name: r.name,
      primaryLanguage: r.primaryLanguage ?? "TypeScript",
      stars: 1000,
      archetype: "org" as RepoArchetype,
      target,
      trendPoints: 6 + (r.name.length % 10), // a gentle, per-repo-varied climb up to `target`
    };
    const reports = reportsForRepo(spec, scansPerRepo, weeksBack, anchor);
    for (const rep of reports) {
      const res = await persistScanReport(rep, { orgSlug: slug });
      if (res && !res.deduped) scansPersisted++;
    }
  }

  return NextResponse.json({ ok: true, org: slug, repos: repos.length, scansPersisted, scansPerRepo, weeksBack });
}
