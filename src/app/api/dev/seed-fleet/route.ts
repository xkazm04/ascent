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
import { seedRequestAuthorized } from "@/lib/dev/seed-auth";
import { isDbConfigured, persistScanReport } from "@/lib/db";
import type { ScanReport } from "@/lib/types";
import { curatedPublicSpecs, fleetSpecs, reportsForRepo } from "@/lib/dev/fleet-seed";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const DEFAULT_ORG = "acme";

function clampInt(v: unknown, dflt: number, min: number, max: number): number {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : dflt;
}

/**
 * Persist a repo's history oldest → newest (so the head pointer lands on the latest scan —
 * persistScanReport only advances it) and report what actually LANDED.
 *
 * `inserted` counts only genuinely new rows. Counting every non-null result made the response
 * contradict the idempotency this route advertises: a second run deduped every scan by design and
 * still answered `fleetScans: 480`, so the one number that could show the dedup working reported the
 * same figure as the first run. /api/dev/seed-history already split the two.
 */
async function persistAll(reports: ScanReport[], orgSlug: string): Promise<{ inserted: number; deduped: number }> {
  let inserted = 0;
  let deduped = 0;
  for (const r of reports) {
    const res = await persistScanReport(r, { orgSlug });
    if (!res) continue;
    if (res.deduped) deduped++;
    else inserted++;
  }
  return { inserted, deduped };
}

export async function POST(req: NextRequest) {
  if (!seedRequestAuthorized(req)) {
    return NextResponse.json(
      { error: "forbidden: set ASCENT_SEED_SECRET and pass it via the x-seed-secret header or ?secret=" },
      { status: 403 },
    );
  }
  if (!isDbConfigured()) {
    return NextResponse.json(
      { error: "persistence is disabled: set DATABASE_URL (or DSQL_ENDPOINT) first" },
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
  let fleetDeduped = 0;
  for (const spec of fleetSpecs(org, repoCount)) {
    const res = await persistAll(reportsForRepo(spec, scansPerRepo, weeksBack, now), org);
    fleetScans += res.inserted;
    fleetDeduped += res.deduped;
    fleetRepos++;
  }

  let publicRepos = 0;
  let publicScans = 0;
  let publicDeduped = 0;
  if (includePublic) {
    for (const spec of curatedPublicSpecs()) {
      const res = await persistAll(reportsForRepo(spec, scansPerRepo, weeksBack, now), "public");
      publicScans += res.inserted;
      publicDeduped += res.deduped;
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
    // Non-zero on a re-run: the deterministic head SHAs deduped instead of piling up duplicates.
    deduped: fleetDeduped + publicDeduped,
    view: {
      orgDashboard: `/org/${org} (dev: set ASCENT_OPEN_ORG_DASHBOARDS=1 + ASCENT_AUTH_BYPASS=1)`,
      landing: "/ (the public register + sample hero now have data)",
    },
  });
}
