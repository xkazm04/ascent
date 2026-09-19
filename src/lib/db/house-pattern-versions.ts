// MOONSHOT #33 — versioned house patterns.
//
// The org's own mined pattern (src/lib/org/practice-mining.ts) was recomputed live on every render and
// never stored, so "the pattern moved" was not a fact the product could hold: a repo that adopted the
// v1 shape and a repo that adopted today's shape were indistinguishable, and re-mining silently
// redefined what conformance meant for every repo that had already adopted.
//
// So a pattern is VERSIONED and IMMUTABLE. An adoption row cites `patternVersion`, and a later mine
// appends a new version beside the old one instead of rewriting it. `patternHash` over the mined lines
// is the change key — a re-mine that produces the same lines writes nothing at all, which is what
// stops a nightly fleet rescan from manufacturing an endless version ladder.
//
// ABSENCE, NOT v0. An org that mines nothing has NO row for that practice. `patternVersion` is `null`
// on a generic / registry / playbook adoption, meaning "not version-tracked" — never "version zero",
// which would read as "behind by one" on a surface that compares versions.
//
// ORG-SCOPED BY CONSTRUCTION, like every other practice-shape read: a mined pattern is one tenant's
// private structure and there is no cross-org variant.

import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { getOrgBySlug } from "@/lib/db/org-shared";
import { getOrgPracticeShapes } from "@/lib/db/org-practice-shapes";
import { MIN_AGREEMENT, minePracticeShapes, minedStarter, patternHash } from "@/lib/org/practice-mining";

/** One immutable version of an org's mined pattern for one practice. Wire-safe: `minedAt` is a string. */
export interface HousePatternRow {
  id: string;
  practiceId: string;
  /** 1-based within (org, practice). */
  version: number;
  /** The starter lines this version carries — `minedStarter()` output. */
  lines: string[];
  /** Repo fullNames that agreed on the shape. Evidence: a suggestion nobody can audit is ignorable. */
  exemplars: string[];
  /** MIN_AGREEMENT in force when this version was mined. */
  agreementMin: number;
  patternHash: string;
  /** ISO string — never a `Date` (wire-safe-dates). */
  minedAt: string;
}

/** Defensive JSON parse of a TEXT `string[]` column. A malformed blob degrades to empty, never throws. */
function parseLines(json: string): string[] {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

interface PatternRecord {
  id: string;
  practiceId: string;
  version: number;
  linesJson: string;
  exemplarsJson: string;
  agreementMin: number;
  patternHash: string;
  minedAt: Date;
}

function toRow(r: PatternRecord): HousePatternRow {
  return {
    id: r.id,
    practiceId: r.practiceId,
    version: r.version,
    lines: parseLines(r.linesJson),
    exemplars: parseLines(r.exemplarsJson),
    agreementMin: r.agreementMin,
    patternHash: r.patternHash,
    minedAt: r.minedAt.toISOString(),
  };
}

/** The newest version of `practiceId`'s house pattern, or null when the org has never mined one. */
export async function getLatestHousePattern(
  orgId: string,
  practiceId: string,
): Promise<HousePatternRow | null> {
  if (!isDbConfigured()) return null;
  const row = await getPrisma().housePatternVersion.findFirst({
    where: { orgId, practiceId },
    orderBy: { version: "desc" },
  });
  return row ? toRow(row) : null;
}

/** Every practice's newest version, keyed by practiceId. Empty when nothing has been mined. */
export async function getLatestHousePatterns(orgSlug: string): Promise<Record<string, HousePatternRow>> {
  if (!isDbConfigured()) return {};
  const org = await getOrgBySlug(orgSlug);
  if (!org) return {};
  // Ascending, so the last write per practice is the highest version.
  const rows = await getPrisma().housePatternVersion.findMany({
    where: { orgId: org.id },
    orderBy: { version: "asc" },
  });
  const out: Record<string, HousePatternRow> = {};
  for (const r of rows) out[r.practiceId] = toRow(r);
  return out;
}

/**
 * Mine `orgSlug`'s patterns and append a version for each one whose lines CHANGED. Returns how many
 * new versions were written (0 is the ordinary steady-state answer).
 *
 * NEVER THROWS. This runs beside a dashboard read and beside an apply; a bookkeeping failure must not
 * take down a tab or block a PR that has already been opened. It logs and reports 0.
 *
 * Idempotent under concurrency by the schema, not by luck: `@@unique([orgId, practiceId, patternHash])`
 * means two simultaneous mines of the same shape produce one row and one caught duplicate-key error.
 */
export async function syncHousePatternVersions(orgSlug: string): Promise<number> {
  if (!isDbConfigured()) return 0;
  try {
    const org = await getOrgBySlug(orgSlug);
    if (!org) return 0;
    const shapes = await getOrgPracticeShapes(orgSlug);
    if (!shapes || shapes.length === 0) return 0;

    const prisma = getPrisma();
    let written = 0;
    for (const mined of minePracticeShapes(shapes)) {
      const lines = minedStarter(mined);
      // An org that mines nothing for this practice gets NO row — absence, not a v0.
      if (!lines) continue;
      const hash = patternHash(lines);

      const existing = await prisma.housePatternVersion.findUnique({
        where: { orgId_practiceId_patternHash: { orgId: org.id, practiceId: mined.practiceId, patternHash: hash } },
        select: { id: true },
      });
      if (existing) continue;

      const latest = await prisma.housePatternVersion.findFirst({
        where: { orgId: org.id, practiceId: mined.practiceId },
        orderBy: { version: "desc" },
        select: { version: true },
      });
      try {
        await prisma.housePatternVersion.create({
          data: {
            orgId: org.id,
            practiceId: mined.practiceId,
            version: (latest?.version ?? 0) + 1,
            linesJson: JSON.stringify(lines),
            exemplarsJson: JSON.stringify(mined.exemplars),
            agreementMin: MIN_AGREEMENT,
            patternHash: hash,
          },
        });
        written += 1;
      } catch {
        // A concurrent sync won the (org, practice, hash) or (org, practice, version) unique — which is
        // exactly the outcome wanted. Not an error; not a second row.
      }
    }
    return written;
  } catch (err) {
    console.error("[house-patterns] sync failed", err instanceof Error ? err.message : err);
    return 0;
  }
}
