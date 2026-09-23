// Data access for the three Shared Org Memory LIFECYCLE verbs — recall, reflect, forget. The judgment
// for all three lives in the pure cores (src/lib/memory/{recall,reflection,decay}.ts); this module only
// fetches the bounded working set and performs the writes those cores decide on. Which rows recall and
// forget reason over is org-memory-population.ts's job (each pass loads its own population there).
//
// Split out of org-memory.ts (which stays CRUD + the supersede write) for the reason AGENTS.md gives for
// db/org.ts and db/scans.ts: themed sub-modules, one barrel. It reuses org-memory.ts's `toRow` and
// `visibilityScope` (and `notExpired`, via activeMemoryWhere) rather than restating them — the §4.5 private-scratch rule and the
// §8 TTL rule must each have exactly one definition in this codebase.
//
// THE TENANT BOUNDARY (§4.1): `orgId` is resolved from the slug server-side and AND-ed into every query
// AND every update here, including the id-list updates — an id list that arrived from a client (or from
// an LLM proposal) can therefore never touch another org's row, no matter how it was obtained.

import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { normalizeOrgSlug } from "@/lib/db/org-shared";
import { toRow, visibilityScope, type MemoryRow } from "@/lib/db/org-memory";
import { activeMemoryWhere } from "@/lib/db/org-memory-population";
import { RECALL_POPULATION_MAX } from "@/lib/memory/working-set";
import { normalizeConfidence } from "@/lib/org/memory-kinds";
import { reflectionScopeKey } from "@/lib/memory/reflection";

/** The one population cap, owned by the pure rules module (working-set.ts) so this door and the
 *  per-pass loaders cannot drift apart on it. */
const WORKING_SET_MAX = RECALL_POPULATION_MAX;

async function orgIdFor(orgSlug: string): Promise<string | null> {
  const org = await getPrisma().organization.findUnique({
    where: { slug: normalizeOrgSlug(orgSlug) },
    select: { id: true },
  });
  return org?.id ?? null;
}

export interface LifecycleFetchOpts {
  namespace?: string;
  kinds?: string[];
  limit?: number;
}

/**
 * The newest-N slice of the active, visible store: not archived, not superseded, not expired, and
 * scoped to what this viewer may see, ordered by updatedAt desc and capped.
 *
 * RECENCY DECIDES THIS POPULATION, so it is the wrong loader for any pass with a rule of its own. The
 * comment here used to claim "an old row that the cap drops was the least likely to win recall anyway";
 * that is false. Half-lives differ by kind (episodic 30 days, procedural 365), so a 120-day runbook
 * outscores a month-old scan episode, and it is exactly the row a recency cut drops first. And
 * `updatedAt` moves on every access bump, so on a busy store the cut holds only rows younger than the
 * forget pass's 60-day grace period. Hence the per-pass loaders in org-memory-population.ts:
 * `recallPopulation` (REST recall, MCP `recall_org_memory`) and `decayPopulation` (the forget pass).
 *
 * What still reads this: reflection's proposal pass (it clusters what is current, and says so with
 * `consideredCount`) and Athena's chat prefetch (60 newest), which is a named follow-up.
 *
 * `namespace` is an optional filter here, unlike candidateOrgMemories' deliberate `null` default. The
 * write-check helper must not be reused as a recall loader: omitted namespace there is IS NULL.
 */
export async function lifecycleWorkingSet(
  orgSlug: string,
  opts: LifecycleFetchOpts = {},
  viewerLogin?: string | null,
): Promise<MemoryRow[]> {
  if (!isDbConfigured()) return [];
  const orgId = await orgIdFor(orgSlug);
  if (!orgId) return [];

  const rows = await getPrisma().orgMemory.findMany({
    where: activeMemoryWhere(orgId, opts, viewerLogin, new Date()),
    orderBy: { updatedAt: "desc" },
    take: Math.min(Math.max(1, opts.limit ?? WORKING_SET_MAX), WORKING_SET_MAX),
  });
  return rows.map(toRow);
}

/**
 * Bump `accessCount` for the memories a recall ACTUALLY returned — one batched updateMany, org-scoped.
 * Best-effort by contract (mirrors recordMemoryRecall): a usage counter must never fail the read it
 * decorates. Returns how many rows were bumped (0 when persistence is off or the pass returned nothing).
 */
export async function bumpMemoryAccessCounts(orgSlug: string, ids: string[]): Promise<number> {
  if (!isDbConfigured() || ids.length === 0) return 0;
  try {
    const orgId = await orgIdFor(orgSlug);
    if (!orgId) return 0;
    const { count } = await getPrisma().orgMemory.updateMany({
      where: { id: { in: ids }, orgId },
      data: { accessCount: { increment: 1 } },
    });
    return count;
  } catch {
    return 0;
  }
}

/** Soft-archive a set of memories (the forget verb's only write). Org-scoped and idempotent — already
 *  archived rows are excluded so the returned count is the number actually retired by THIS pass. */
export async function archiveOrgMemories(orgSlug: string, ids: string[]): Promise<number> {
  if (!isDbConfigured() || ids.length === 0) return 0;
  const orgId = await orgIdFor(orgSlug);
  if (!orgId) return 0;
  const { count } = await getPrisma().orgMemory.updateMany({
    where: { id: { in: ids }, orgId, archived: false },
    data: { archived: true },
  });
  return count;
}

export interface ApplyReflectionInput {
  summaryContent: string;
  memberIds: string[];
  confidence: number;
  namespace?: string;
}

export class ReflectionMembersNotFoundError extends Error {
  constructor(found: number, asked: number) {
    super(`Only ${found} of ${asked} member memories are live in this organization.`);
    this.name = "ReflectionMembersNotFoundError";
  }
}

/** The members of one rollup do not share one ownership scope (namespace, visibility, private author). */
export class ReflectionScopeMismatchError extends Error {
  constructor(scopes: number) {
    super(`The member memories span ${scopes} scopes; a rollup must stay inside one namespace and visibility.`);
    this.name = "ReflectionScopeMismatchError";
  }
}

/**
 * Apply an accepted summary proposal, in ONE transaction:
 *   1. create the `summary`-kind row (source "reflection", tags ["auto-reflection"] — so an auto rollup
 *      is always distinguishable from one a human wrote, in the UI and in any later audit);
 *   2. stamp every member `supersededBy = <summary id>`.
 *
 * The members therefore drop out of recall and default reads while staying in the table, linked to the
 * memory that replaced them — the same non-destructive correction path createOrgMemory uses for a
 * single supersede (§8 "versioning"). NEVER a delete.
 *
 * Both statements are scoped to `{ orgId }` and the member update additionally requires
 * `supersededBy: null`. If the count doesn't match what we were asked to supersede, the WHOLE
 * transaction rolls back (ReflectionMembersNotFoundError): a rollup that consolidated only some of its
 * sources is worse than none, because the survivors now contradict a summary claiming to cover them.
 *
 * `version` is max(member version) + 1, so the rollup carries the deepest lineage it consolidates.
 */
export async function applyReflection(
  orgSlug: string,
  input: ApplyReflectionInput,
  createdBy?: string | null,
): Promise<{ id: string; superseded: number } | null> {
  if (!isDbConfigured()) return null;
  const prisma = getPrisma();
  const orgId = await orgIdFor(orgSlug);
  if (!orgId) return null;

  const memberIds = [...new Set(input.memberIds)];
  const ns = (input.namespace ?? "").trim().slice(0, 100);

  return prisma.$transaction(async (tx) => {
    // Members are resolved under the applier's own visibility, so another author's private scratch is
    // "not found" here exactly as it is in every read.
    const members = await tx.orgMemory.findMany({
      where: {
        id: { in: memberIds },
        orgId,
        archived: false,
        supersededBy: null,
        AND: [visibilityScope(createdBy)],
      },
      select: { version: true, namespace: true, visibility: true, createdBy: true },
    });
    if (members.length !== memberIds.length) {
      throw new ReflectionMembersNotFoundError(members.length, memberIds.length);
    }
    // The door re-checks what clustering already partitioned: a member list can arrive from a client.
    const scopes = new Set(
      members.map((m) =>
        reflectionScopeKey({ namespace: m.namespace ?? "", visibility: m.visibility, createdBy: m.createdBy }),
      ),
    );
    const memberNs = (members[0]!.namespace ?? "").trim();
    if (scopes.size !== 1 || (ns !== "" && ns !== memberNs)) {
      throw new ReflectionScopeMismatchError(scopes.size === 1 ? 2 : scopes.size);
    }
    const isPrivate = members[0]!.visibility === "private";

    const created = await tx.orgMemory.create({
      data: {
        orgId,
        content: input.summaryContent.trim().slice(0, 20_000),
        kind: "summary",
        // The rollup inherits its members' scope; it never takes one from the request.
        namespace: memberNs === "" ? null : memberNs,
        visibility: isPrivate ? "private" : "shared",
        source: "reflection",
        confidence: normalizeConfidence(input.confidence),
        tags: JSON.stringify(["auto-reflection"]),
        version: Math.max(0, ...members.map((m) => m.version)) + 1,
        createdBy: isPrivate ? members[0]!.createdBy : (createdBy ?? null),
      },
      select: { id: true },
    });

    const { count } = await tx.orgMemory.updateMany({
      where: { id: { in: memberIds }, orgId, supersededBy: null },
      data: { supersededBy: created.id },
    });
    // Lost a race to another corrector between the read and the write: roll back rather than leave a
    // summary standing beside a member it claims to have replaced.
    if (count !== memberIds.length) throw new ReflectionMembersNotFoundError(count, memberIds.length);

    return { id: created.id, superseded: count };
  });
}
