// Custom repo segments — user-defined named slices of the fleet (platform, mobile, legacy,
// acquisitions). A segment is an org-scoped tag; repos are tagged via RepoSegment (many-to-many).
// Every org aggregate in src/lib/db/org.ts accepts an optional `segmentId` that scopes it to a
// segment's repos, and `compareSegments` puts two segments side by side (the segment-vs-segment
// view). Like the rest of src/lib/db, every function is a no-op / null when DATABASE_URL is unset.

import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { postureFor } from "@/lib/maturity/model";
import { getOrgRollup, type OrgRepoRow } from "@/lib/db/org";
import { getOrgId } from "@/lib/db/org-rollup";
import { roundedMean } from "@/lib/db/org-shared";

const DEFAULT_COLOR = "#3b9eff";
const NAME_MAX = 60;

/** Trim and bound a user-supplied segment name. */
export function normalizeSegmentName(raw: string): string {
  return raw.trim().slice(0, NAME_MAX);
}

/** Validate a `#rrggbb` (or `#rgb`) hex color; fall back to the brand accent when malformed. */
export function normalizeColor(raw?: string | null): string {
  if (!raw) return DEFAULT_COLOR;
  const v = raw.trim();
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(v) ? v.toLowerCase() : DEFAULT_COLOR;
}

export interface SegmentRow {
  id: string;
  name: string;
  color: string;
  repoCount: number; // repos currently tagged into this segment
  createdAt: string;
}

/** All segments for an org, with live tagged-repo counts, newest first. */
export async function listSegments(orgSlug: string): Promise<SegmentRow[] | null> {
  if (!isDbConfigured()) return null;
  const orgId = await getOrgId(orgSlug);
  if (!orgId) return [];
  const segments = await getPrisma().segment.findMany({
    where: { orgId },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, color: true, createdAt: true, _count: { select: { repos: true } } },
  });
  return segments.map((s) => ({
    id: s.id,
    name: s.name,
    color: s.color,
    repoCount: s._count.repos,
    createdAt: s.createdAt.toISOString(),
  }));
}

export async function createSegment(
  orgSlug: string,
  input: { name: string; color?: string | null },
): Promise<{ id: string } | null> {
  if (!isDbConfigured()) return null;
  const prisma = getPrisma();
  const org = await prisma.organization.upsert({
    where: { slug: orgSlug },
    update: {},
    create: { slug: orgSlug, name: orgSlug === "public" ? "Public Scans" : orgSlug },
  });
  const created = await prisma.segment.create({
    data: { orgId: org.id, name: normalizeSegmentName(input.name), color: normalizeColor(input.color) },
    select: { id: true },
  });
  return created;
}

export async function updateSegment(id: string, data: { name?: string; color?: string | null }): Promise<boolean> {
  if (!isDbConfigured()) return false;
  await getPrisma().segment.update({
    where: { id },
    data: {
      ...(data.name != null ? { name: normalizeSegmentName(data.name) } : {}),
      ...("color" in data ? { color: normalizeColor(data.color) } : {}),
    },
  });
  return true;
}

/** Delete a segment and its membership rows (no DB cascade under relationMode="prisma"). */
export async function deleteSegment(id: string): Promise<boolean> {
  if (!isDbConfigured()) return false;
  const prisma = getPrisma();
  await prisma.repoSegment.deleteMany({ where: { segmentId: id } });
  await prisma.segment.delete({ where: { id } });
  return true;
}

/** The owning org's slug for a segment id (per-row tenant gate on /api/org/segments/:id). Null = unknown id. */
export async function getSegmentOrgSlug(id: string): Promise<string | null> {
  if (!isDbConfigured()) return null;
  const s = await getPrisma().segment.findUnique({ where: { id }, select: { org: { select: { slug: true } } } });
  return s?.org.slug ?? null;
}

/**
 * Tag (`member=true`) or untag (`member=false`) a repo into a segment, scoped to the org so a
 * caller can't touch another tenant's data. Idempotent. Returns false when the segment or repo
 * doesn't belong to the org (or persistence is off).
 */
export async function setRepoSegment(
  orgSlug: string,
  segmentId: string,
  fullName: string,
  member: boolean,
): Promise<boolean> {
  if (!isDbConfigured()) return false;
  const prisma = getPrisma();
  const orgId = await getOrgId(orgSlug);
  if (!orgId) return false;
  const [segment, repo] = await Promise.all([
    prisma.segment.findFirst({ where: { id: segmentId, orgId }, select: { id: true } }),
    prisma.repository.findUnique({ where: { orgId_fullName: { orgId, fullName } }, select: { id: true } }),
  ]);
  if (!segment || !repo) return false;

  if (member) {
    await prisma.repoSegment.upsert({
      where: { segmentId_repoId: { segmentId, repoId: repo.id } },
      update: {},
      create: { segmentId, repoId: repo.id },
    });
  } else {
    await prisma.repoSegment.deleteMany({ where: { segmentId, repoId: repo.id } });
  }
  return true;
}

/**
 * Bulk tag (`member=true`) or untag (`member=false`) MANY repos into a segment in one round-trip —
 * the backend for auto-segments (by language) and the leaderboard's bulk action bar. Org-scoped:
 * the segment must belong to the org and only the org's repos are touched (unknown fullNames are
 * ignored). Idempotent — adds use `createMany({ skipDuplicates })`, removes a bounded `deleteMany`.
 * Returns the number of membership rows actually created/deleted, or -1 when the segment isn't the
 * org's (or persistence is off) so the route can 404.
 */
export async function setRepoSegmentsBulk(
  orgSlug: string,
  segmentId: string,
  fullNames: string[],
  member: boolean,
): Promise<number> {
  if (!isDbConfigured()) return -1;
  const prisma = getPrisma();
  const orgId = await getOrgId(orgSlug);
  if (!orgId) return -1;
  const segment = await prisma.segment.findFirst({ where: { id: segmentId, orgId }, select: { id: true } });
  if (!segment) return -1;
  const unique = [...new Set(fullNames.filter((f) => typeof f === "string"))];
  if (unique.length === 0) return 0;
  const repos = await prisma.repository.findMany({
    where: { orgId, fullName: { in: unique } },
    select: { id: true },
  });
  if (repos.length === 0) return 0;
  if (member) {
    const res = await prisma.repoSegment.createMany({
      data: repos.map((r) => ({ segmentId, repoId: r.id })),
      skipDuplicates: true,
    });
    return res.count;
  }
  const res = await prisma.repoSegment.deleteMany({ where: { segmentId, repoId: { in: repos.map((r) => r.id) } } });
  return res.count;
}

/** Per-repo segment membership: fullName → the segments it's tagged into (for the tagging UI). */
export async function getRepoSegmentMap(
  orgSlug: string,
): Promise<Record<string, { id: string; name: string; color: string }[]>> {
  if (!isDbConfigured()) return {};
  const orgId = await getOrgId(orgSlug);
  if (!orgId) return {};
  const rows = await getPrisma().repoSegment.findMany({
    where: { segment: { orgId } },
    select: {
      repo: { select: { fullName: true } },
      segment: { select: { id: true, name: true, color: true } },
    },
  });
  const out: Record<string, { id: string; name: string; color: string }[]> = {};
  for (const r of rows) (out[r.repo.fullName] ||= []).push(r.segment);
  for (const fn of Object.keys(out)) out[fn]!.sort((a, b) => a.name.localeCompare(b.name)); // safe: fn comes from Object.keys(out)
  return out;
}

// ── Segment-vs-segment comparison ─────────────────────────────────────────────

/** One side of a comparison — a segment's (or the whole fleet's) headline maturity shape. */
export interface SegmentSummary {
  id: string | null; // null = the whole fleet (the comparison baseline)
  name: string;
  repoCount: number;
  scannedCount: number;
  avgOverall: number;
  avgAdoption: number;
  avgRigor: number;
  posture: string; // posture id derived from avg adoption × rigor
  dimAverages: { dimId: string; avg: number }[];
}

export interface SegmentComparison {
  a: SegmentSummary;
  b: SegmentSummary;
  /** a − b on the headline metrics. */
  deltas: { overall: number; adoption: number; rigor: number };
  /** Per-dimension a/b/delta over the union of dimensions either side is scored on. */
  dimDeltas: { dimId: string; a: number; b: number; delta: number }[];
}

/** Pure: diff two segment summaries into headline + per-dimension deltas (a − b). Unit-tested. */
export function buildSegmentComparison(a: SegmentSummary, b: SegmentSummary): SegmentComparison {
  const aDim = new Map(a.dimAverages.map((d) => [d.dimId, d.avg]));
  const bDim = new Map(b.dimAverages.map((d) => [d.dimId, d.avg]));
  const dimIds = [...new Set([...aDim.keys(), ...bDim.keys()])].sort();
  return {
    a,
    b,
    deltas: {
      overall: a.avgOverall - b.avgOverall,
      adoption: a.avgAdoption - b.avgAdoption,
      rigor: a.avgRigor - b.avgRigor,
    },
    dimDeltas: dimIds.map((dimId) => {
      const av = aDim.get(dimId) ?? 0;
      const bv = bDim.get(dimId) ?? 0;
      return { dimId, a: av, b: bv, delta: av - bv };
    }),
  };
}

/**
 * Reduce an in-memory set of a segment's repos (already filtered out of ONE fleet rollup) to its
 * headline maturity summary — the same arithmetic summarizeSegment derives from a scoped getOrgRollup,
 * but without issuing a per-segment fleet query. The repo set must be the fleet rollup's rows
 * (`watched OR has-scans`) filtered by segment membership, which is exactly what a segment-scoped
 * getOrgRollup would return, so the numbers match the A/B comparison.
 */
function summarizeSegmentFromRepos(seg: { id: string; name: string }, repos: OrgRepoRow[]): SegmentSummary {
  const scanned = repos.filter((r) => r.latest);
  const dimSum: Record<string, { sum: number; n: number }> = {};
  for (const r of scanned)
    for (const d of r.latest!.dims) {
      const entry = (dimSum[d.dimId] = dimSum[d.dimId] || { sum: 0, n: 0 });
      entry.sum += d.score;
      entry.n += 1;
    }
  const dimAverages = Object.keys(dimSum)
    .sort()
    .map((dimId) => {
      const entry = dimSum[dimId]!; // safe: dimId comes from Object.keys(dimSum)
      return { dimId, avg: Math.round(entry.sum / entry.n) };
    });
  const avgAdoption = roundedMean(scanned.map((r) => r.latest!.adoption));
  const avgRigor = roundedMean(scanned.map((r) => r.latest!.rigor));
  return {
    id: seg.id,
    name: seg.name,
    repoCount: repos.length,
    scannedCount: scanned.length,
    avgOverall: roundedMean(scanned.map((r) => r.latest!.overall)),
    avgAdoption,
    avgRigor,
    posture: postureFor(avgAdoption, avgRigor).id,
    dimAverages,
  };
}

/** Headline maturity summary for every segment of an org, newest first — the per-segment rollup strip
 *  on the comparison page. Fetches ONE fleet rollup + the repo→segment map, then derives each summary
 *  in memory by filtering the already-loaded repos — previously this ran a full getOrgRollup PER segment
 *  (K+ complete fleet-table scans on one page load, growing linearly with segment count). The single
 *  A/B comparison (compareSegments) still uses the scoped getOrgRollup. */
export async function listSegmentSummaries(orgSlug: string): Promise<SegmentSummary[] | null> {
  if (!isDbConfigured()) return null;
  const [segs, rollup, segMap] = await Promise.all([
    listSegments(orgSlug),
    getOrgRollup(orgSlug),
    getRepoSegmentMap(orgSlug),
  ]);
  if (!segs) return null;
  if (!rollup) return []; // org missing / nothing to roll up — match the prior empty-out behaviour
  // Invert fullName → segments[] into segmentId → set of member fullNames.
  const membersBySeg = new Map<string, Set<string>>();
  for (const [fullName, list] of Object.entries(segMap)) {
    for (const s of list) {
      let set = membersBySeg.get(s.id);
      if (!set) membersBySeg.set(s.id, (set = new Set()));
      set.add(fullName);
    }
  }
  return segs.map((s) => {
    const members = membersBySeg.get(s.id);
    const repos = members ? rollup.repos.filter((r) => members.has(r.fullName)) : [];
    return summarizeSegmentFromRepos({ id: s.id, name: s.name }, repos);
  });
}

/**
 * Shared rollup→summary reducer behind summarizeSegment AND summarizeTechStack (tech-groups.ts):
 * scope getOrgRollup to a custom segment OR an auto tech-stack group (or neither = whole fleet), then
 * reduce it to the headline SegmentSummary. Both callers produced an identical mapping — only the
 * rollup scope and the id/name labels differed — so the reduction lives here once. Passing a null
 * scope id is equivalent to omitting it (techGroupScope/segmentScope treat null and undefined alike).
 */
export async function summarizeScopedRollup(
  orgSlug: string,
  opts: { segmentId?: string | null; groupId?: string | null; id: string | null; name: string },
): Promise<SegmentSummary | null> {
  const rollup = await getOrgRollup(orgSlug, undefined, opts.segmentId ?? null, opts.groupId ?? null);
  if (!rollup) return null;
  return {
    id: opts.id,
    name: opts.name,
    repoCount: rollup.repoCount,
    scannedCount: rollup.scannedCount,
    avgOverall: rollup.avgOverall,
    avgAdoption: rollup.avgAdoption,
    avgRigor: rollup.avgRigor,
    posture: postureFor(rollup.avgAdoption, rollup.avgRigor).id,
    dimAverages: rollup.dimAverages,
  };
}

/** Reduce a segment (or the whole fleet, when `seg` is null) to its headline maturity summary. */
function summarizeSegment(orgSlug: string, seg: { id: string; name: string } | null): Promise<SegmentSummary | null> {
  return summarizeScopedRollup(orgSlug, { segmentId: seg?.id ?? null, id: seg?.id ?? null, name: seg?.name ?? "Whole fleet" });
}

/**
 * Compare two segments side by side (platform vs legacy). `bId` may be null to compare a segment
 * against the whole fleet. Reuses getOrgRollup's scoped averages, so the comparison stays a single
 * source of truth. Returns null when persistence is off, the org is unknown, or `aId` isn't a
 * segment of the org.
 */
export async function compareSegments(
  orgSlug: string,
  aId: string,
  bId: string | null,
): Promise<SegmentComparison | null> {
  if (!isDbConfigured()) return null;
  const orgId = await getOrgId(orgSlug);
  if (!orgId) return null;
  const ids = bId ? [aId, bId] : [aId];
  const segments = await getPrisma().segment.findMany({
    where: { orgId, id: { in: ids } },
    select: { id: true, name: true },
  });
  const a = segments.find((s) => s.id === aId);
  if (!a) return null;
  const b = bId ? segments.find((s) => s.id === bId) ?? null : null;

  const [sumA, sumB] = await Promise.all([
    summarizeSegment(orgSlug, a),
    summarizeSegment(orgSlug, b),
  ]);
  if (!sumA || !sumB) return null;
  return buildSegmentComparison(sumA, sumB);
}
