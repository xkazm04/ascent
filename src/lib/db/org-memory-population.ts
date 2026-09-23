// Data access for the POPULATION each Shared Org Memory lifecycle pass reasons over. The pure rules
// (per-kind recall lanes, forget's derived predicate) live in src/lib/memory/working-set.ts; this module
// runs them against the store and returns rows through org-memory.ts's one mapper (`toRow`).
//
// Why it exists: every pass used to load `updatedAt desc, take 400` and apply its own policy after the
// cut, so recency decided what recall could rank, what forget could retire and what the MCP query could
// match. Here each pass states its own population:
//   - recallPopulation: one groupBy count per kind, then one findMany per lane. Query terms, when given,
//     are part of the WHERE, so relevance filtering happens before the cap rather than after it.
//   - decayPopulation: the oldest rows the forget conjunction could act on, and nothing else.
//
// THE TENANT BOUNDARY (§4.1) and the read rules are composed, never restated: orgId is resolved from the
// slug server-side, and `visibilityScope` (§4.5 private scratch) and `notExpired` (§8 TTL) come from
// org-memory.ts, their single definitions.

import type { Prisma } from "@prisma/client";
import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { normalizeOrgSlug } from "@/lib/db/org-shared";
import { notExpired, toRow, visibilityScope, type MemoryRow } from "@/lib/db/org-memory";
import {
  DECAY_POPULATION_MAX,
  DECAY_POPULATION_ORDER,
  RECALL_POPULATION_MAX,
  decayPopulationWhere,
  planRecallLanes,
} from "@/lib/memory/working-set";

export interface PopulationScope {
  /** Narrow to one namespace. Omitted or blank = no filter (never IS NULL; see lifecycleWorkingSet). */
  namespace?: string;
  /** Restrict to these kinds. Empty/omitted = every kind. */
  kinds?: string[];
}

export interface RecallPopulationOpts extends PopulationScope {
  /** Relevance terms: a row must contain at least one in its content or tags (case-insensitive). */
  terms?: string[];
  /** Cap on rows loaded; clamped to [1, RECALL_POPULATION_MAX]. */
  limit?: number;
}

export interface RecallPopulation {
  rows: MemoryRow[];
  /** Eligible rows the cap left out. They were never scored, so no ranking can speak for them. */
  notConsidered: number;
}

const MAX_TERMS = 20;
const MAX_TERM_LENGTH = 100;

async function memoryOrgId(orgSlug: string): Promise<string | null> {
  const org = await getPrisma().organization.findUnique({
    where: { slug: normalizeOrgSlug(orgSlug) },
    select: { id: true },
  });
  return org?.id ?? null;
}

/**
 * The live, visible rows of one org: not archived, not superseded, not expired, and scoped to what this
 * viewer may see, plus the optional namespace/kind narrowing. Shared with lifecycleWorkingSet so the
 * old door and the new ones cannot disagree about what "live" means.
 */
export function activeMemoryWhere(
  orgId: string,
  scope: PopulationScope,
  viewerLogin: string | null | undefined,
  now: Date,
): Prisma.OrgMemoryWhereInput {
  const where: Prisma.OrgMemoryWhereInput = {
    orgId,
    archived: false,
    supersededBy: null,
    AND: [notExpired(now), visibilityScope(viewerLogin)],
  };
  const ns = scope.namespace?.trim();
  if (ns) where.namespace = ns;
  if (scope.kinds?.length) where.kind = { in: scope.kinds };
  return where;
}

/** Lower-cased, trimmed, de-duplicated and bounded: a query cannot become an unbounded OR. */
function cleanTerms(terms: string[] | undefined): string[] {
  const out = (terms ?? []).map((t) => String(t).trim().toLowerCase().slice(0, MAX_TERM_LENGTH)).filter(Boolean);
  return [...new Set(out)].slice(0, MAX_TERMS);
}

/**
 * The recall population: the cap split across kinds by planRecallLanes, each lane its kind's most
 * recently updated rows (within one kind the half-life is shared, so recency is a fair proxy for value
 * there, and only there). Rows come back newest first, the order lifecycleWorkingSet returned, so a
 * store under the cap loads exactly what it used to.
 *
 * The count and the lane reads are separate queries, so a write landing between them can make
 * `notConsidered` off by the rows that write touched. It is a statement about the store at read time,
 * not a lock on it.
 */
export async function recallPopulation(
  orgSlug: string,
  opts: RecallPopulationOpts = {},
  viewerLogin?: string | null,
): Promise<RecallPopulation> {
  const empty: RecallPopulation = { rows: [], notConsidered: 0 };
  if (!isDbConfigured()) return empty;
  const orgId = await memoryOrgId(orgSlug);
  if (!orgId) return empty;

  const where = activeMemoryWhere(orgId, opts, viewerLogin, new Date());
  const terms = cleanTerms(opts.terms);
  if (terms.length) {
    (where.AND as Prisma.OrgMemoryWhereInput[]).push({
      OR: terms.flatMap((t) => [
        { content: { contains: t, mode: "insensitive" as const } },
        // `tags` is stored as a JSON string[]; a substring match on it is the SQL image of the
        // handler's `tags.join(" ").includes(term)`.
        { tags: { contains: t, mode: "insensitive" as const } },
      ]),
    });
  }

  const prisma = getPrisma();
  const groups = await prisma.orgMemory.groupBy({ by: ["kind"], where, _count: { _all: true } });
  const counts = Object.fromEntries(groups.map((g) => [g.kind, g._count._all]));
  const limit = Math.min(Math.max(1, opts.limit ?? RECALL_POPULATION_MAX), RECALL_POPULATION_MAX);
  const plan = planRecallLanes(counts, limit);

  const lanes = await Promise.all(
    Object.entries(plan.quotas)
      .filter(([, take]) => take > 0)
      .map(([kind, take]) => prisma.orgMemory.findMany({ where: { ...where, kind }, orderBy: { updatedAt: "desc" }, take })),
  );
  const rows = lanes
    .flat()
    .map(toRow)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return { rows, notConsidered: plan.notConsidered };
}

/**
 * The forget population: live, visible rows that meet decay.ts's row-level conditions (not an exempt
 * kind, low confidence, older than the grace period), oldest first. decay.ts still judges every row it
 * is given; this only guarantees the rows it is given are ones it could act on.
 */
export async function decayPopulation(
  orgSlug: string,
  scope: Pick<PopulationScope, "namespace"> = {},
  viewerLogin: string | null | undefined,
  nowMs: number,
): Promise<MemoryRow[]> {
  if (!isDbConfigured()) return [];
  const orgId = await memoryOrgId(orgSlug);
  if (!orgId) return [];

  const where = activeMemoryWhere(orgId, { namespace: scope.namespace }, viewerLogin, new Date(nowMs));
  (where.AND as Prisma.OrgMemoryWhereInput[]).push(decayPopulationWhere(nowMs));
  const rows = await getPrisma().orgMemory.findMany({
    where,
    orderBy: DECAY_POPULATION_ORDER,
    take: DECAY_POPULATION_MAX,
  });
  return rows.map(toRow);
}
