// The server read behind the roadmap's basis clause: one org's measured lift map, once per request.
//
// SERVER ONLY — it reaches the ledger through `@/lib/db/outcomes`. The pure half it feeds
// (`aggregateLift`, `expectedLiftClause`, `sortRoadmap`) is client-importable; this file is the seam
// between them and must never be imported from a `"use client"` module.

import { cache } from "react";

import { listOrgOutcomes, toOutcomeSample } from "@/lib/db/outcomes";
import { aggregateLift, type LiftDistribution } from "@/lib/outcomes/aggregate";

/** Lift distributions keyed by `recommendationMatchKey(dimension, title)`. */
export type LiftsByIdentity = ReadonlyMap<string, LiftDistribution>;

export const EMPTY_LIFTS: LiftsByIdentity = new Map();

/**
 * The org's measured lifts for ROADMAP GAPS, keyed by the identity a rendered roadmap item can
 * compute for itself (`recommendationMatchKey(dimension, title)` — the same key the sandbox, the
 * carry-forward diff and org decisions use, so one gap has one identity across every surface).
 *
 * Only `kind: "recommendation"` rows are folded in. The other three kinds live in a DIFFERENT identity
 * namespace — a practice id, a skill id, a hashed scenario selection — and joining them onto a roadmap
 * title by dimension alone would attribute one practice's measured movement to every gap in its
 * dimension. That is the kind of plausible-looking join this ledger exists to make unnecessary; those
 * kinds are read by their own surfaces through `listOrgOutcomes`.
 *
 * `cache()` scopes it to one request, so a page rendering both the roadmap and the tracker reads once.
 * Never spans `orgId`: `listOrgOutcomes` is org-scoped and `scope: "org"` keeps the floors tenant-local.
 */
export const getOrgExpectedLifts = cache(async (orgSlug: string): Promise<LiftsByIdentity> => {
  const rows = await listOrgOutcomes(orgSlug, { kind: "recommendation" });
  if (!rows.length) return EMPTY_LIFTS;
  const partitions = aggregateLift(rows.map(toOutcomeSample), { scope: "org" });
  return bestPerIdentity(partitions);
});

/**
 * Collapse instrument partitions to one per identity: the best-EVIDENCED partition, never a blend.
 *
 * A gap measured under both r9 and r10 has two honest answers, and the clause can only carry one. It
 * takes the one with more samples (ties to the later rubric string, so the choice is deterministic and
 * leans toward the current instrument) and the clause names which instrument it was — so a reader who
 * bumped the rubric last week can see that the number predates the bump instead of being told a
 * blended median that describes neither ruler.
 */
export function bestPerIdentity(partitions: ReadonlyMap<string, LiftDistribution>): LiftsByIdentity {
  const out = new Map<string, LiftDistribution>();
  for (const d of partitions.values()) {
    const cur = out.get(d.identityKey);
    if (!cur || d.n > cur.n || (d.n === cur.n && d.instrument.rubricVersion > cur.instrument.rubricVersion)) {
      out.set(d.identityKey, d);
    }
  }
  return out;
}
