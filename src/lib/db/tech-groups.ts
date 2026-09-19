// Auto-maintained tech-stack groups (Feature 3b). syncTechStackGroups reconciles a repo's group
// memberships from its detected stack on every scan (frontend / backend:<lang> / mobile / …);
// listTechStackGroups feeds the TechStackSelector. Distinct from user-owned Segments (src/lib/db/
// segments.ts) — these are derived + immutable. The role→group-key mapping lives in one place
// (techGroupsFor, src/lib/org/tech-stack.ts) so the badge a user sees and the group they filter match.

import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { getOrgId, getOrgRollup } from "@/lib/db/org-rollup";
import { summarizeScopedRepos, type SegmentSummary } from "@/lib/db/segments";
import { techGroupsFor } from "@/lib/org/tech-stack";
import type { TechStack } from "@/lib/types";

export interface TechGroupSummary {
  id: string;
  key: string;
  label: string;
  repoCount: number;
}

/**
 * Reconcile a repo's tech-group memberships from its detected stack. Derives the repo's group keys,
 * upserts the org's groups (create-or-relabel), then ADDS new memberships and REMOVES stale ones — so a
 * re-stacked repo moves groups cleanly. Idempotent. No-op for a null/absent stack (a reconstructed
 * snapshot leaves existing memberships untouched, mirroring the techStack cache + team attribution).
 * Best-effort by contract — the caller swallows errors so grouping never breaks a scan persist.
 */
export async function syncTechStackGroups(
  orgId: string,
  repoId: string,
  stack: TechStack | null | undefined,
): Promise<void> {
  if (!isDbConfigured() || !stack) return;
  const prisma = getPrisma();
  const desired = techGroupsFor(stack);

  const desiredIds = new Set<string>();
  for (const g of desired) {
    const row = await prisma.techStackGroup.upsert({
      where: { orgId_key: { orgId, key: g.key } },
      update: { label: g.label },
      create: { orgId, key: g.key, label: g.label },
      select: { id: true },
    });
    desiredIds.add(row.id);
  }

  const existing = await prisma.techStackGroupMember.findMany({ where: { repoId }, select: { id: true, groupId: true } });
  const existingGroupIds = new Set(existing.map((m) => m.groupId));
  const toRemove = existing.filter((m) => !desiredIds.has(m.groupId)).map((m) => m.id);
  const toAdd = [...desiredIds].filter((gid) => !existingGroupIds.has(gid));

  if (toRemove.length) await prisma.techStackGroupMember.deleteMany({ where: { id: { in: toRemove } } });
  if (toAdd.length) {
    await prisma.techStackGroupMember.createMany({
      data: toAdd.map((groupId) => ({ groupId, repoId })),
      skipDuplicates: true,
    });
  }
}

/** Resolve a tech-group KEY (the stable `?stack=` value) → its group id within an org, or null. For
 *  consumers that carry the key rather than the id (the briefing PDF route + the shared-briefing page,
 *  which mirror the page's `?stack=<key>` semantics). Org-scoped, so a key never crosses tenants. */
export async function getTechGroupIdByKey(orgSlug: string, key: string | null | undefined): Promise<string | null> {
  if (!isDbConfigured() || !key) return null;
  const prisma = getPrisma();
  const orgId = await getOrgId(orgSlug);
  if (!orgId) return null;
  const g = await prisma.techStackGroup.findUnique({
    where: { orgId_key: { orgId, key } },
    select: { id: true },
  });
  return g?.id ?? null;
}

// Display order: frontend → backend(s) → mobile → data/ML → infra → library → (anything else).
const ROLE_ORDER = ["frontend", "backend", "mobile", "data_ml", "infra", "library"];
function groupSortRank(key: string): number {
  const base = key.split(":")[0]!;
  const i = ROLE_ORDER.indexOf(base);
  return i === -1 ? ROLE_ORDER.length : i;
}

/**
 * The org's NON-EMPTY tech groups for the selector — id, stable key, display label, and repo count.
 * Empty groups (a repo left after re-stacking) are hidden so the selector never shows a dead 0-count
 * pill. Sorted frontend → backend(s) → mobile → …, then by label. [] when off / unknown org.
 */
export async function listTechStackGroups(orgSlug: string): Promise<TechGroupSummary[]> {
  if (!isDbConfigured()) return [];
  const prisma = getPrisma();
  const orgId = await getOrgId(orgSlug);
  if (!orgId) return [];
  const groups = await prisma.techStackGroup.findMany({
    where: { orgId },
    include: { _count: { select: { members: true } } },
  });
  return groups
    .map((g) => ({ id: g.id, key: g.key, label: g.label, repoCount: g._count.members }))
    .filter((g) => g.repoCount > 0)
    .sort((a, b) => groupSortRank(a.key) - groupSortRank(b.key) || a.label.localeCompare(b.label));
}

/**
 * groupId → set of member repo fullNames for the whole org, in ONE query. The in-memory equivalent of
 * `techGroupScope`'s where-fragment (`techGroups: { some: { groupId } }`), read from the same join
 * table, so partitioning a fleet rollup by this map selects EXACTLY the repos a group-scoped
 * getOrgRollup would have fetched. Mirrors getRepoSegmentMap (segments.ts), which plays the same role
 * for listSegmentSummaries. Empty map when persistence is off or the org is unknown.
 */
async function getTechGroupMemberMap(orgSlug: string): Promise<Map<string, Set<string>>> {
  const byGroup = new Map<string, Set<string>>();
  if (!isDbConfigured()) return byGroup;
  const orgId = await getOrgId(orgSlug);
  if (!orgId) return byGroup;
  const rows = await getPrisma().techStackGroupMember.findMany({
    where: { group: { orgId } },
    select: { groupId: true, repo: { select: { fullName: true } } },
  });
  for (const r of rows) {
    let set = byGroup.get(r.groupId);
    if (!set) byGroup.set(r.groupId, (set = new Set()));
    set.add(r.repo.fullName);
  }
  return byGroup;
}

/** Headline summary for every non-empty tech group of an org — the per-stack matrix on the
 *  comparison page. `includeFleet` prepends the whole-fleet baseline (id null, name "Whole fleet")
 *  so per-stack numbers can be anchored against the org average.
 *
 *  Fetches ONE fleet rollup + the group→member map, then derives each group's summary in memory by
 *  filtering the already-loaded rows — previously this ran a full getOrgRollup PER GROUP, sequentially
 *  ("Sequential since N is small"), so `/tech-stacks` cost `groups × whole-fleet-rollup` and grew with
 *  exactly the stack diversity the page exists to analyse. Same fix, same shape, as listSegmentSummaries.
 *  Since the A/B comparison was deleted (tombstone at the foot of this file) this is the tab's ONLY
 *  per-stack read. */
export async function listTechStackSummaries(
  orgSlug: string,
  opts?: { includeFleet?: boolean },
): Promise<SegmentSummary[] | null> {
  if (!isDbConfigured()) return null;
  const [groups, rollup, membersByGroup] = await Promise.all([
    listTechStackGroups(orgSlug),
    getOrgRollup(orgSlug),
    getTechGroupMemberMap(orgSlug),
  ]);
  // Org missing / nothing to roll up — every per-group summary would have been null anyway.
  if (!rollup) return [];
  const out: SegmentSummary[] = [];
  if (opts?.includeFleet) out.push(summarizeScopedRepos({ id: null, name: "Whole fleet" }, rollup.repos));
  for (const g of groups) {
    const members = membersByGroup.get(g.id);
    const repos = members ? rollup.repos.filter((r) => members.has(r.fullName)) : [];
    // The summary id carries the stack KEY (the stable `?stack=` value); the name carries the label.
    out.push(summarizeScopedRepos({ id: g.key, name: g.label }, repos));
  }
  return out;
}

// The side-by-side A-vs-B stack comparison (3b-P2) lived here — `compareTechStacks` plus its
// `summarizeTechStack` helper (a `summarizeScopedRollup` wrapper), mirroring compareSegments over tech
// groups, and `tech-groups-compare.test.ts`. Deleted 2026-08-19 with the "Compare stacks" panel that
// was its only caller: the Tech Stacks tab's dimension-analysis board already diagnoses every
// dimension across every stack, with a transformation playbook attached, so a hand-picked pair was a
// strictly narrower read of the same numbers. Segments keep their comparison (compareSegments,
// src/lib/db/segments.ts) — that surface still exists, and still uses summarizeScopedRollup.
