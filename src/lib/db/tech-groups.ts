// Auto-maintained tech-stack groups (Feature 3b). syncTechStackGroups reconciles a repo's group
// memberships from its detected stack on every scan (frontend / backend:<lang> / mobile / …);
// listTechStackGroups feeds the TechStackSelector. Distinct from user-owned Segments (src/lib/db/
// segments.ts) — these are derived + immutable. The role→group-key mapping lives in one place
// (techGroupsFor, src/lib/org/tech-stack.ts) so the badge a user sees and the group they filter match.

import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { getOrgId, getOrgRollup } from "@/lib/db/org-rollup";
import { buildSegmentComparison, type SegmentComparison, type SegmentSummary } from "@/lib/db/segments";
import { techGroupsFor } from "@/lib/org/tech-stack";
import { postureFor } from "@/lib/maturity/model";
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

// ── Side-by-side stack comparison (3b-P2 — the optional /tech-stacks page) ─────────────────────────
// Mirrors compareSegments: reuses getOrgRollup's scoped averages + the pure buildSegmentComparison, so
// the stack comparison stays a single source of truth with every other scoped view. SegmentSummary.id
// here carries the stack KEY (or null = whole fleet); name carries the display label.

/** Reduce a tech-stack group (or the whole fleet, when `group` is null) to its headline summary. */
async function summarizeTechStack(
  orgSlug: string,
  group: { id: string; key: string; label: string } | null,
): Promise<SegmentSummary | null> {
  const rollup = await getOrgRollup(orgSlug, undefined, null, group?.id ?? null);
  if (!rollup) return null;
  return {
    id: group?.key ?? null,
    name: group?.label ?? "Whole fleet",
    repoCount: rollup.repoCount,
    scannedCount: rollup.scannedCount,
    avgOverall: rollup.avgOverall,
    avgAdoption: rollup.avgAdoption,
    avgRigor: rollup.avgRigor,
    posture: postureFor(rollup.avgAdoption, rollup.avgRigor).id,
    dimAverages: rollup.dimAverages,
  };
}

/** Headline summary for every non-empty tech group of an org — the per-stack rollup strip on the
 *  comparison page. Sequential since N is small. */
export async function listTechStackSummaries(orgSlug: string): Promise<SegmentSummary[] | null> {
  if (!isDbConfigured()) return null;
  const groups = await listTechStackGroups(orgSlug);
  const out: SegmentSummary[] = [];
  for (const g of groups) {
    const sum = await summarizeTechStack(orgSlug, g);
    if (sum) out.push(sum);
  }
  return out;
}

/**
 * Compare two tech-stack groups side by side (e.g. Frontend vs Backend·Python). `keyB` may be null to
 * compare a stack against the whole fleet. Reuses getOrgRollup's scoped averages + buildSegmentComparison.
 * Null when off, the org is unknown, or `keyA` isn't a (non-empty) group of the org. A bogus `keyB`
 * falls back to the whole-fleet baseline (mirrors compareSegments).
 */
export async function compareTechStacks(
  orgSlug: string,
  keyA: string,
  keyB: string | null,
): Promise<SegmentComparison | null> {
  if (!isDbConfigured()) return null;
  const groups = await listTechStackGroups(orgSlug);
  const a = groups.find((g) => g.key === keyA);
  if (!a) return null;
  const b = keyB ? groups.find((g) => g.key === keyB) ?? null : null;
  const [sumA, sumB] = await Promise.all([summarizeTechStack(orgSlug, a), summarizeTechStack(orgSlug, b)]);
  if (!sumA || !sumB) return null;
  return buildSegmentComparison(sumA, sumB);
}
