// Registry WRITE helpers — the state-machine transitions and the index-result stamp, split out of
// `org-registry.ts` so the read model (types + loaders) stays small and importable on its own.
// Pure DB, no GitHub.

import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { parseRegistryJson, type OrgRegistryRow, type RegistryMigrationStep, type RegistryStatusValue } from "@/lib/db/org-registry";

/** Result of one index pass, as `recordIndexResult` persists it. */
export interface IndexResultInput {
  headSha: string;
  counts: { skills: number; practices: number; memory: number; lessons: number };
  warnings: string[];
  catalogSha?: string | null;
  /** Aggregate of the registry's `usage/` lane, when the pass read it. */
  usage?: { invokes30d: number; contributors: number };
  /** The knowledge/ lane's bundles, when the pass read them. */
  bundles?: unknown[];
}

/**
 * Move a registry through the onboarding state machine. `patch` carries the fields that only make
 * sense with a particular status (the scaffold PR url, the last error) so a caller can't leave a
 * stale `lastError` sitting on an `indexed` row — moving OFF `error` clears it.
 */
export async function setRegistryStatus(
  id: string,
  status: RegistryStatusValue,
  patch: { scaffoldPrUrl?: string | null; lastError?: string | null; webhookHealthy?: boolean } = {},
): Promise<void> {
  if (!isDbConfigured()) return;
  await getPrisma().orgRegistry.update({
    where: { id },
    data: {
      status,
      lastError: patch.lastError !== undefined ? patch.lastError : status === "error" ? undefined : null,
      ...(patch.scaffoldPrUrl !== undefined ? { scaffoldPrUrl: patch.scaffoldPrUrl } : {}),
      ...(patch.webhookHealthy !== undefined ? { webhookHealthy: patch.webhookHealthy } : {}),
    },
  });
}

/** Stamp a SUCCESSFUL index pass: head sha, timestamp, denormalized counts and the skip warnings. */
export async function recordIndexResult(id: string, result: IndexResultInput): Promise<void> {
  if (!isDbConfigured()) return;
  await getPrisma().orgRegistry.update({
    where: { id },
    data: {
      status: "indexed",
      lastIndexedAt: new Date(),
      lastIndexSha: result.headSha,
      skillCount: result.counts.skills,
      practiceCount: result.counts.practices,
      memoryCount: result.counts.memory,
      lessonCount: result.counts.lessons,
      warningsJson: JSON.stringify(result.warnings.slice(0, 50)),
      lastError: null,
      ...(result.catalogSha !== undefined ? { catalogSha: result.catalogSha } : {}),
      // Omitted rather than zeroed when the pass did not read the lane: writing 0
      // would turn "not measured this pass" into "nobody uses anything".
      ...(result.usage
        ? { usageInvokes30d: result.usage.invokes30d, usageContributors: result.usage.contributors }
        : {}),
      // Same rule as usage: omitted when the pass did not read the lane, so
      // "not measured" never overwrites a good reading with an empty one.
      ...(result.bundles ? { bundlesJson: JSON.stringify(result.bundles) } : {}),
    },
  });
}

/** Record a FAILED index pass without destroying the previous (still readable) index. */
export async function recordIndexError(id: string, message: string): Promise<void> {
  await setRegistryStatus(id, "error", { lastError: message.slice(0, 2000) });
}

/** Persist one artifact type's migration step (the "open migration PR" action's result). */
export async function setMigrationStep(
  id: string,
  type: "skills" | "practices" | "memory",
  step: RegistryMigrationStep,
): Promise<void> {
  if (!isDbConfigured()) return;
  const prisma = getPrisma();
  const current = await prisma.orgRegistry.findUnique({ where: { id }, select: { migrationJson: true } });
  const migration = parseRegistryJson<OrgRegistryRow["migration"]>(current?.migrationJson ?? null, {});
  migration[type] = step;
  await prisma.orgRegistry.update({ where: { id }, data: { migrationJson: JSON.stringify(migration) } });
}

/**
 * SOFT-ARCHIVE every mirror row of `registryId` whose path was NOT seen in this pass — so a file
 * deleted in git disappears from the read surfaces without its history being destroyed. An empty set
 * for a type is honored (a registry that deleted all its skills archives all of them).
 */
export async function archiveVanishedRegistryRows(
  registryId: string,
  seen: { skills: string[]; practices: string[]; memory: string[] },
): Promise<{ skills: number; practices: number; memory: number }> {
  if (!isDbConfigured()) return { skills: 0, practices: 0, memory: 0 };
  const prisma = getPrisma();
  const gone = (paths: string[]) => ({
    registryId,
    archived: false,
    ...(paths.length ? { registryPath: { notIn: paths } } : {}),
  });
  const [skills, practices, memory] = await Promise.all([
    prisma.orgSkill.updateMany({ where: gone(seen.skills), data: { archived: true } }),
    prisma.orgPracticeShape.updateMany({ where: gone(seen.practices), data: { archived: true } }),
    prisma.orgMemory.updateMany({ where: gone(seen.memory), data: { archived: true } }),
  ]);
  return { skills: skills.count, practices: practices.count, memory: memory.count };
}

/** Registry-backed vs hosted-only live counts for one org — the Registry tab's three-artifact ledger. */
export async function countRegistryMirrors(
  orgId: string,
): Promise<Record<"skills" | "practices" | "memory", { registry: number; hostedOnly: number }>> {
  if (!isDbConfigured()) {
    const zero = { registry: 0, hostedOnly: 0 };
    return { skills: { ...zero }, practices: { ...zero }, memory: { ...zero } };
  }
  const prisma = getPrisma();
  const live = { orgId, archived: false };
  const [sr, sh, pr, ph, mr, mh] = await Promise.all([
    prisma.orgSkill.count({ where: { ...live, origin: "registry" } }),
    prisma.orgSkill.count({ where: { ...live, origin: { not: "registry" } } }),
    prisma.orgPracticeShape.count({ where: { ...live, origin: "registry" } }),
    prisma.orgPracticeShape.count({ where: { ...live, origin: { not: "registry" } } }),
    prisma.orgMemory.count({ where: { ...live, origin: "registry" } }),
    prisma.orgMemory.count({ where: { ...live, origin: { not: "registry" } } }),
  ]);
  return {
    skills: { registry: sr, hostedOnly: sh },
    practices: { registry: pr, hostedOnly: ph },
    memory: { registry: mr, hostedOnly: mh },
  };
}
