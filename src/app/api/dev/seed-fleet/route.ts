// POST /api/dev/seed-fleet — DEV/DEMO ONLY. Generates a large synthetic fleet (an org of many repos,
// each with a back-dated scan history) plus a curated set of well-known public repos, and persists
// them through the real persistScanReport path. Runs IN the server process, so it works against the
// local embedded PGlite database AND a production Aurora DSQL cluster alike (a standalone script can't
// reach the in-process PGlite). Idempotent: the generator's deterministic head SHAs dedup on re-run.
//
// Gating: when ASCENT_SEED_SECRET is set, the caller must present it (x-seed-secret header or ?secret=)
// — so this can be run once safely against a deployed instance. With no secret configured it is allowed
// only outside production (local dev / preview), never on a bare prod deploy.

import { NextResponse, type NextRequest } from "next/server";
import { isDbConfigured, persistScanReport } from "@/lib/db";
import type { ScanReport } from "@/lib/types";
import { curatedPublicSpecs, fleetSpecs, reportsForRepo } from "@/lib/dev/fleet-seed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const DEFAULT_ORG = "acme";

function authorized(req: NextRequest): boolean {
  const secret = process.env.ASCENT_SEED_SECRET?.trim();
  if (secret) {
    const provided =
      req.headers.get("x-seed-secret") ?? new URL(req.url).searchParams.get("secret");
    return provided === secret;
  }
  // No secret configured → allow only outside production, so a bare prod deploy can't be seeded by anyone.
  return process.env.NODE_ENV !== "production";
}

function clampInt(v: unknown, dflt: number, min: number, max: number): number {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : dflt;
}

async function persistAll(reports: ScanReport[], orgSlug: string): Promise<number> {
  let n = 0;
  // Oldest → newest so the repo head pointer lands on the latest scan (persistScanReport only advances it).
  for (const r of reports) {
    const res = await persistScanReport(r, { orgSlug });
    if (res) n++;
  }
  return n;
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json(
      { error: "forbidden — set ASCENT_SEED_SECRET and pass it via the x-seed-secret header or ?secret=" },
      { status: 403 },
    );
  }
  if (!isDbConfigured()) {
    return NextResponse.json(
      { error: "persistence is disabled — set DATABASE_URL (or DSQL_ENDPOINT) first" },
      { status: 400 },
    );
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const org = typeof body.org === "string" && body.org.trim() ? body.org.trim() : DEFAULT_ORG;
  const repoCount = clampInt(body.repoCount, 60, 1, 400);
  const scansPerRepo = clampInt(body.scansPerRepo, 8, 1, 24);
  const weeksBack = clampInt(body.weeksBack, 12, 1, 104);
  const includePublic = body.includePublic !== false;

  const now = Date.now();
  let fleetRepos = 0;
  let fleetScans = 0;
  for (const spec of fleetSpecs(org, repoCount)) {
    fleetScans += await persistAll(reportsForRepo(spec, scansPerRepo, weeksBack, now), org);
    fleetRepos++;
  }

  let publicRepos = 0;
  let publicScans = 0;
  if (includePublic) {
    for (const spec of curatedPublicSpecs()) {
      publicScans += await persistAll(reportsForRepo(spec, scansPerRepo, weeksBack, now), "public");
      publicRepos++;
    }
  }

  return NextResponse.json({
    ok: true,
    org,
    fleetRepos,
    fleetScans,
    publicRepos,
    publicScans,
    view: {
      orgDashboard: `/org/${org} (dev: set ASCENT_OPEN_ORG_DASHBOARDS=1 + ASCENT_AUTH_BYPASS=1)`,
      landing: "/ (the public register + sample hero now have data)",
    },
  });
}
