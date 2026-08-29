// `OrgSkillUsageSample` — the registry `usage/` lane persisted per index pass (#19, sink B).
//
// A SNAPSHOT, NOT A LEDGER. Every row is upserted on `(registryId, contributor, skillName)`, so
// re-indexing the same head is a no-op and cannot double-count. That is the whole reason these counts
// are never turned into `OrgSkillEvent` rows: the registry publishes a running total with no event
// identity, so an append-shaped mirror of it would inflate on every pass. The dormancy verdict folds
// these at READ time (`skillUsageMap`), which is idempotent by construction.
//
// Following the standing `org-registry*` convention, these are NOT re-exported from `@/lib/db` by this
// module's own initiative — the barrel line is requested at merge.

import { getPrisma, isDbConfigured } from "@/lib/db/client";
import type { UsageSample } from "@/lib/registry/usage-samples";

/** One contributor's reported counts for one skill. Client-facing: timestamps are ISO strings. */
export interface SkillUsageSampleRow {
  registryId: string;
  orgId: string;
  /** `usage/<contributor>.json` stem — an installation, never a person and never a repo. */
  contributor: string;
  /** Registry skill NAME; a registry-only skill has no `OrgSkill` id. */
  skillName: string;
  invokes: number;
  windowDays: number;
  /** NULL when the file omitted `lastUsed`. Never back-filled from `generatedAt`. */
  lastUsedAt: string | null;
  generatedAt: string;
}

/** Every sample for one org, for the dormancy fold. [] when persistence is off. */
export async function listOrgSkillUsageSamples(orgId: string): Promise<SkillUsageSampleRow[]> {
  if (!isDbConfigured()) return [];
  const rows = await getPrisma().orgSkillUsageSample.findMany({
    where: { orgId },
    orderBy: [{ skillName: "asc" }, { contributor: "asc" }],
  });
  return rows.map(toRow);
}

function toRow(r: {
  registryId: string;
  orgId: string;
  contributor: string;
  skillName: string;
  invokes: number;
  windowDays: number;
  lastUsedAt: Date | null;
  generatedAt: Date;
}): SkillUsageSampleRow {
  return {
    registryId: r.registryId,
    orgId: r.orgId,
    contributor: r.contributor,
    skillName: r.skillName,
    invokes: r.invokes,
    windowDays: r.windowDays,
    lastUsedAt: r.lastUsedAt ? r.lastUsedAt.toISOString() : null,
    generatedAt: r.generatedAt.toISOString(),
  };
}

/**
 * Upsert one index pass's samples. Returns how many rows were written.
 *
 * Best-effort per row, deliberately: a registry with one contributor whose file names a skill with a
 * pathological name must not cost the whole lane its counts. Nothing here throws to the indexer,
 * which never lets one artifact fail a pass.
 */
export async function recordUsageSamples(
  registryId: string,
  orgId: string,
  samples: UsageSample[],
): Promise<number> {
  if (!isDbConfigured() || !samples.length) return 0;
  const prisma = getPrisma();
  let written = 0;
  for (const s of samples) {
    const contributor = s.contributor.slice(0, 200);
    const skillName = s.skillName.slice(0, 200);
    if (!contributor || !skillName) continue;
    const invokes = Number.isFinite(s.invokes) && s.invokes > 0 ? Math.floor(s.invokes) : 0;
    const windowDays = Number.isFinite(s.windowDays) && s.windowDays > 0 ? Math.floor(s.windowDays) : 30;
    const lastUsedAt = s.lastUsed && Number.isFinite(Date.parse(s.lastUsed)) ? new Date(s.lastUsed) : null;
    const generatedAt = Number.isFinite(Date.parse(s.generatedAt)) ? new Date(s.generatedAt) : new Date();
    const data = { invokes, windowDays, lastUsedAt, generatedAt };
    try {
      await prisma.orgSkillUsageSample.upsert({
        where: { registryId_contributor_skillName: { registryId, contributor, skillName } },
        update: data,
        create: { registryId, orgId, contributor, skillName, ...data },
      });
      written += 1;
    } catch {
      /* one malformed contribution degrades itself, never the pass */
    }
  }
  return written;
}

/**
 * Delete the samples of contributors that vanished from the lane, mirroring
 * `archiveVanishedRegistryRows`. These are DELETED rather than archived because a snapshot has no
 * history worth keeping: a contributor's file going away means the counts it asserted are no longer
 * asserted by anyone, and keeping the last one would let a decommissioned installation hold a skill
 * `active` indefinitely.
 *
 * An EMPTY `seen` list is honoured (a registry whose whole usage lane was deleted loses every sample).
 * The caller is responsible for not calling this on a pass it could not read — see the truncated-tree
 * guard in `indexRegistry`.
 */
export async function purgeUsageSamples(registryId: string, seenContributors: string[]): Promise<number> {
  if (!isDbConfigured()) return 0;
  const seen = Array.from(new Set(seenContributors.map((c) => c.slice(0, 200)).filter(Boolean)));
  const { count } = await getPrisma().orgSkillUsageSample.deleteMany({
    where: { registryId, ...(seen.length ? { contributor: { notIn: seen } } : {}) },
  });
  return count;
}
