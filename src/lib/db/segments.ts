// Custom repo segments — user-defined named slices of the fleet (platform, mobile, legacy,
// acquisitions). A segment is an org-scoped tag; repos are tagged via RepoSegment (many-to-many).
// Every org aggregate in src/lib/db/org.ts accepts an optional `segmentId` that scopes it to a
// segment's repos, and `compareSegments` puts two segments side by side (the segment-vs-segment
// view). Like the rest of src/lib/db, every function is a no-op / null when DATABASE_URL is unset.

import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { postureFor } from "@/lib/maturity/model";
import { getOrgRollup } from "@/lib/db/org";

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

async function resolveOrgId(slug: string): Promise<string | null> {
  const org = await getPrisma().organization.findUnique({ where: { slug }, select: { id: true } });
  return org?.id ?? null;
}

/** All segments for an org, with live tagged-repo counts, newest first. */
export async function listSegments(orgSlug: string): Promise<SegmentRow[] | null> {
  if (!isDbConfigured()) return null;
  const orgId = await resolveOrgId(orgSlug);
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
  // Resolve an EXISTING org — never upsert one into being. On auth-off deployments the route's access
  // gate is permissive, so upserting here let any caller materialize a junk org row (with name=slug)
  // for an arbitrary slug. Match every sibling function's "unknown org → no-op" contract instead.
  const orgId = await resolveOrgId(orgSlug);
  if (!orgId) return null;
  const created = await prisma.segment.create({
    data: { orgId, name: normalizeSegmentName(input.name), color: normalizeColor(input.color) },
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
  const orgId = await resolveOrgId(orgSlug);
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
  const orgId = await resolveOrgId(orgSlug);
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
  const orgId = await resolveOrgId(orgSlug);
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

/** Resolve `mapper` over `items` with at most `limit` promises in flight, preserving input order.
 *  Bounds the fan-out so a many-segment org doesn't open N concurrent rollups (each 2-3 DB round
 *  trips) at once and exhaust the connection pool. */
async function mapPool<T, R>(items: T[], limit: number, mapper: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    for (let i = next++; i < items.length; i = next++) {
      out[i] = await mapper(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/** Headline maturity summary for every segment of an org (each scoped via getOrgRollup), newest
 *  first — the per-segment rollup strip on the comparison page. */
export async function listSegmentSummaries(orgSlug: string): Promise<SegmentSummary[] | null> {
  if (!isDbConfigured()) return null;
  const segs = await listSegments(orgSlug);
  if (!segs) return null;
  // Bounded-concurrency fan-out (was a sequential await-loop): each segment's rollup is 2-3 DB round
  // trips and segment count is user-created / unbounded, so an org with 30-50 segments serialized
  // 30-50 full rollups on the Segments tab's TTFB. Parallelize with a cap to avoid pool exhaustion.
  const sums = await mapPool(segs, 6, (s) => summarizeSegment(orgSlug, { id: s.id, name: s.name }));
  return sums.filter((s): s is SegmentSummary => s !== null);
}

/** Reduce a segment (or the whole fleet, when `seg` is null) to its headline maturity summary. */
async function summarizeSegment(orgSlug: string, seg: { id: string; name: string } | null): Promise<SegmentSummary | null> {
  const rollup = await getOrgRollup(orgSlug, undefined, seg?.id ?? null);
  if (!rollup) return null;
  return {
    id: seg?.id ?? null,
    name: seg?.name ?? "Whole fleet",
    repoCount: rollup.repoCount,
    scannedCount: rollup.scannedCount,
    avgOverall: rollup.avgOverall,
    avgAdoption: rollup.avgAdoption,
    avgRigor: rollup.avgRigor,
    posture: postureFor(rollup.avgAdoption, rollup.avgRigor).id,
    dimAverages: rollup.dimAverages,
  };
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
  const orgId = await resolveOrgId(orgSlug);
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
