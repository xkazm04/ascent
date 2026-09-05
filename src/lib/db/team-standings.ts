// Persistence for the team-standings decomposition — the "why the top leads / bottom lags" analysis
// captured as a durable OUTPUT of a full org scan (see src/lib/org/teamStandings.ts for the pure
// derivation). The org scan routes call persistTeamStandings() best-effort at the end of the scan
// loop; the Teams page calls getTeamStandingsProvenance() to stamp the section with when it was
// captured. Writes/reads go through raw SQL so a new table needs no Prisma-client regeneration (the
// table is created by prisma/init.sql on PGlite boot and by the migration in prod) — mirroring the
// $queryRaw pattern in usage.ts. Everything here is best-effort: it must never break a scan or a render.

import { randomUUID } from "node:crypto";
import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { normalizeOrgSlug } from "@/lib/db/org-shared";
import { getOrgTeamRollup } from "@/lib/db/org-teams";
import { explainTeamStandings } from "@/lib/org/teamStandings";

/** Lightweight provenance for the Teams page's "captured by the org scan …" stamp — read from the
 *  denormalized columns, so it never has to parse the stored JSON. */
export interface TeamStandingsProvenance {
  generatedAt: Date;
  source: string;
  spread: number;
  leaderSlug: string;
  laggardSlug: string;
}

/**
 * Capture the current team-standings decomposition as an append-row snapshot. Best-effort — resolves
 * to `false` (never throws) when persistence is off, the org is unknown, there aren't ≥2 teams to
 * contrast, or the write fails (e.g. the table isn't present yet on an un-rebooted dev DB). Called
 * from the org scan/import routes after every repo is persisted, so the rollup it reads is fresh.
 */
export async function persistTeamStandings(orgSlug: string): Promise<boolean> {
  if (!isDbConfigured()) return false;
  try {
    const prisma = getPrisma();
    const org = await prisma.organization.findUnique({ where: { slug: normalizeOrgSlug(orgSlug) } });
    if (!org) return false;

    const rollup = await getOrgTeamRollup(orgSlug);
    const standings = rollup && explainTeamStandings(rollup.teams);
    if (!standings) return false;

    await prisma.$executeRaw`
      INSERT INTO "TeamStandingSnapshot"
        ("id", "orgId", "generatedAt", "teamCount", "fleetAvgOverall", "spread",
         "leaderSlug", "leaderScore", "laggardSlug", "laggardScore", "standingsJson", "source")
      VALUES (${randomUUID()}, ${org.id}, ${new Date()}, ${standings.teamCount}, ${standings.fleetAvgOverall}, ${standings.spread},
         ${standings.leader.slug}, ${standings.leader.avgOverall}, ${standings.laggard.slug}, ${standings.laggard.avgOverall},
         ${JSON.stringify(standings)}, ${"scan"})
    `;
    return true;
  } catch (err) {
    console.error("[team-standings] snapshot write failed", err instanceof Error ? err.message : err);
    return false;
  }
}

/**
 * The most recent snapshot's provenance for `orgSlug`, or null when none exists / persistence is off /
 * the table isn't present yet. Reads only the denormalized headline columns (no JSON parse), so a
 * corrupt `standingsJson` can never break the page — the page still renders the live decomposition and
 * only uses this to stamp when it was captured.
 */
export async function getTeamStandingsProvenance(orgSlug: string): Promise<TeamStandingsProvenance | null> {
  if (!isDbConfigured()) return null;
  try {
    const prisma = getPrisma();
    const org = await prisma.organization.findUnique({ where: { slug: normalizeOrgSlug(orgSlug) } });
    if (!org) return null;

    const rows = await prisma.$queryRaw<
      { generatedAt: Date; source: string; spread: number; leaderSlug: string; laggardSlug: string }[]
    >`
      SELECT "generatedAt", "source", "spread", "leaderSlug", "laggardSlug"
      FROM "TeamStandingSnapshot"
      WHERE "orgId" = ${org.id}
      ORDER BY "generatedAt" DESC
      LIMIT 1
    `;
    const row = rows[0];
    if (!row) return null;
    return {
      generatedAt: row.generatedAt instanceof Date ? row.generatedAt : new Date(row.generatedAt),
      source: row.source,
      spread: Number(row.spread),
      leaderSlug: row.leaderSlug,
      laggardSlug: row.laggardSlug,
    };
  } catch (err) {
    console.error("[team-standings] provenance read failed", err instanceof Error ? err.message : err);
    return null;
  }
}
