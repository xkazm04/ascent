// The PUBLIC-CORPUS DOOR (card portfolio-0). Every public ranking reads the same corpus - /leaderboard
// and /scorecard through `register/data.ts`, the landing register and /about's live fleet through
// `db/scans-gallery.ts` - and they used to hold its rules in two different shapes: the register
// re-checked tenancy per row and never ranked a mock floor, the gallery did neither. This module is the
// one place those rules are stated, so both read paths inherit them instead of restating them.
//
// Registry: peer-benchmarking `corpus-tenancy-boundary` (route every corpus-building read through one
// door; filter per row at assembly) and `comparability-filters` (only rows from the ranking engine enter
// the ranking; unknown provenance is excluded).
//
// PURE: no Prisma client, no `next/*`. `src/lib/register/public-corpus-door.test.ts` pins that every
// Prisma read under src/lib/register/** carries `publicCorpusWhere`.

import { BENCHMARK_ELIGIBLE, isMockEngine } from "@/lib/corpus/eligibility";

/** The tenancy fragment for every public read: the PUBLIC org AND a public repository. Spread it into
 *  every `where` (and re-assert it on an id-keyed fetch); an id list is never proof of tenancy. */
export function publicCorpusWhere(orgId: string): { orgId: string; isPrivate: false } {
  return { orgId, isPrivate: false };
}

/** The per-row half of tenancy: a private row is refused whatever query returned it (a legacy persist
 *  or a repo that went private after its scan can sit under the public org). */
export function publicRowOrNull<T extends { isPrivate?: boolean | null }>(row: T): T | null {
  return row.isPrivate ? null : row;
}

/**
 * True when a scan's score may wear a board position. Derived from the ENGINE half of
 * `BENCHMARK_ELIGIBLE` only: a mock score had no model in it and is not a rating, and an unknown engine
 * is not evidence of one. The rubric half is deliberately NOT applied here - a stale-rubric row is a
 * real rating on an earlier instrument, so the public boards qualify it with a chip and keep ranking it.
 */
export function isRankableScan(engine: string | null | undefined): boolean {
  return typeof engine === "string" && engine.length > 0 && !isMockEngine(engine);
}

/** The same rule as a Prisma `ScanWhereInput` fragment, for windows that must rank rankable scans only. */
export const RANKABLE_ENGINE_WHERE = { engineProvider: BENCHMARK_ELIGIBLE.engineProvider };

/** Its complement: the preview (mock) scans, which get their own bounded window and are never ranked. */
export const PREVIEW_ENGINE_WHERE = { engineProvider: BENCHMARK_ELIGIBLE.engineProvider.not };

/** The one rank comparator for every public board: score desc, then the more recent scan, then a stable
 *  fullName tiebreak - so the landing register and /leaderboard order the same rows the same way. */
export function byRank(
  a: { overall: number; scannedAt: string; fullName: string },
  b: { overall: number; scannedAt: string; fullName: string },
): number {
  return b.overall - a.overall || b.scannedAt.localeCompare(a.scannedAt) || a.fullName.localeCompare(b.fullName);
}
