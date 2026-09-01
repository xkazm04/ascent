// Weekly digest — assembly over the existing org aggregates for the trailing 7 calendar days.
// STUB: the signature is the wire contract (see digest-types.ts); WP1 fills in the body.

import type { WeeklyDigest } from "./digest-types";

export type { WeeklyDigest } from "./digest-types";

/** Assemble the weekly digest for an org. Null when nothing has been scanned. */
export async function buildWeeklyDigest(orgSlug: string, now: Date = new Date()): Promise<WeeklyDigest | null> {
  void orgSlug;
  void now;
  return null;
}
