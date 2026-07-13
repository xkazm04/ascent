// Shared Org Memory (Memory-as-a-Service MVP) — CRUD + server-side filter/sort + the supersede
// (versioning) write behind /api/org/memory. Mirrors the Skills stack (src/lib/db/org-skills.ts) but
// swaps the skill's `category` for `namespace` + `kind`, and adds the design doc's anti-poisoning
// fields (`confidence`, `source`, `supersededBy`). `tags` is stored as a JSON string[]; this module is
// the single place memory fields are (de)serialized + bounded.
//
// THE TENANT BOUNDARY (design doc §4): `orgId` is resolved server-side from the slug and AND-ed into
// EVERY query here — it is never taken from a request param alone. A caller asking for a memory in an
// org it can't reach gets nothing from this layer, and the routes independently re-authorize via
// getOrgMemoryOrgSlug. Belt and suspenders, exactly as §4.1–4.2 prescribe.
//
// Default reads drop `supersededBy != null` (a correction replaced it — §7.4) and expired rows (§8
// TTL), and hide other authors' `visibility='private'` scratch (§4.5).

import { Prisma, type OrgMemory } from "@prisma/client";
import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { normalizeOrgSlug } from "@/lib/db/org-shared";
import {
  isMemoryKind,
  normalizeConfidence,
  normalizeMemoryKind,
  normalizeMemoryVisibility,
} from "@/lib/org/memory-kinds";

/** How the list is ordered. `recent` (default) = last edited; `confidence` = most trusted first;
 *  `recalls` = most-used first (the accessCount tally). */
export type MemorySort = "recent" | "confidence" | "recalls";

export interface MemoryRow {
  id: string;
  /** Optional in-org grouping tag (the design doc's "project" stand-in). "" when org-wide. */
  namespace: string;
  content: string;
  kind: string;
  visibility: string;
  /** Provenance — the agent/tool/human that produced this. "" when unstated. */
  source: string;
  /** 0..1 trust score — ranking + pruning. */
  confidence: number;
  tags: string[];
  /** Set when a correction replaced this memory; such rows are hidden from default reads. */
  supersededBy: string | null;
  version: number;
  accessCount: number;
  expiresAt: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MemoryInput {
  content: string;
  kind?: string;
  namespace?: string;
  visibility?: string;
  source?: string;
  confidence?: number;
  tags?: string[];
  expiresAt?: Date | null;
  /** When set, this write is a CORRECTION: the target memory is marked superseded by the new row. */
  supersedeId?: string;
}

export interface MemoryListOpts {
  namespace?: string;
  kind?: string;
  search?: string;
  sort?: MemorySort;
  /** Include rows a correction replaced. Off by default (design doc §7.4). */
  includeSuperseded?: boolean;
  /** Cap the result set. Defaults to 200 — the UI list is a browse surface, not an export. */
  limit?: number;
}

/** 20KB body cap — bounds storage and the (bounded) LLM consolidation prompt built from candidates. */
const MAX_CONTENT = 20_000;
const DEFAULT_LIMIT = 200;

/** Raised when a supersede targets a memory that isn't in the caller's org (or doesn't exist). The
 *  route maps this to a 400 rather than silently creating an orphan "correction" of nothing. */
export class SupersedeTargetNotFoundError extends Error {
  constructor() {
    super("The memory to supersede was not found in this organization.");
    this.name = "SupersedeTargetNotFoundError";
  }
}

function parseTags(raw: string): string[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** Trim/cap tags and serialize to JSON (≤20 tags, ≤40 chars each) — bounds the secondary refinement. */
function cleanTags(tags: string[] | undefined): string {
  const out = (tags ?? [])
    .filter((t) => typeof t === "string" && t.trim())
    .map((t) => t.trim().slice(0, 40))
    .slice(0, 20);
  return JSON.stringify(out);
}

const cleanContent = (s: string) => s.trim().slice(0, MAX_CONTENT);
/** A blank namespace means "org-wide" and is stored as NULL, so the index doesn't fill with "". */
const cleanNamespace = (s: string | undefined) => {
  const v = (s ?? "").trim().slice(0, 100);
  return v === "" ? null : v;
};
const cleanSource = (s: string | undefined) => {
  const v = (s ?? "").trim().slice(0, 200);
  return v === "" ? null : v;
};

function toRow(m: OrgMemory): MemoryRow {
  return {
    id: m.id,
    namespace: m.namespace ?? "",
    content: m.content,
    kind: m.kind,
    visibility: m.visibility,
    source: m.source ?? "",
    confidence: m.confidence,
    tags: parseTags(m.tags),
    supersededBy: m.supersededBy,
    version: m.version,
    accessCount: m.accessCount,
    expiresAt: m.expiresAt ? m.expiresAt.toISOString() : null,
    createdBy: m.createdBy,
    createdAt: m.createdAt.toISOString(),
    updatedAt: m.updatedAt.toISOString(),
  };
}

/**
 * The visibility fragment (design doc §4.5): `shared` memories are readable by every member;
 * `private` ones only by their author. An ANONYMOUS/unknown viewer sees ONLY shared rows — never
 * another person's scratch. This is the single place that rule is expressed.
 */
function visibilityScope(viewerLogin: string | null | undefined): Prisma.OrgMemoryWhereInput {
  return viewerLogin
    ? { OR: [{ visibility: "shared" }, { visibility: "private", createdBy: viewerLogin }] }
    : { visibility: "shared" };
}

/** The TTL fragment (§8): a row with no `expiresAt` is permanent; one in the past is already gone. */
function notExpired(now: Date): Prisma.OrgMemoryWhereInput {
  return { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] };
}

function orderFor(sort: MemorySort | undefined): Prisma.OrgMemoryOrderByWithRelationInput[] {
  if (sort === "confidence") return [{ confidence: "desc" }, { updatedAt: "desc" }];
  if (sort === "recalls") return [{ accessCount: "desc" }, { updatedAt: "desc" }];
  return [{ updatedAt: "desc" }];
}

/**
 * Server-filtered memory list for an org: orgId + not-archived, minus superseded/expired rows and
 * other authors' private scratch, plus optional namespace/kind filters and a case-insensitive
 * content/source/namespace search. Null when persistence is off; [] for an unknown org (so a bogus
 * slug is indistinguishable from an empty one).
 */
export async function listOrgMemories(
  orgSlug: string,
  opts: MemoryListOpts = {},
  viewerLogin?: string | null,
): Promise<MemoryRow[] | null> {
  if (!isDbConfigured()) return null;
  const prisma = getPrisma();
  const org = await prisma.organization.findUnique({
    where: { slug: normalizeOrgSlug(orgSlug) },
    select: { id: true },
  });
  if (!org) return [];

  const and: Prisma.OrgMemoryWhereInput[] = [
    notExpired(new Date()),
    visibilityScope(viewerLogin),
  ];

  const search = opts.search?.trim();
  if (search) {
    and.push({
      OR: [
        { content: { contains: search, mode: "insensitive" } },
        { source: { contains: search, mode: "insensitive" } },
        { namespace: { contains: search, mode: "insensitive" } },
      ],
    });
  }

  const where: Prisma.OrgMemoryWhereInput = { orgId: org.id, archived: false, AND: and };
  if (!opts.includeSuperseded) where.supersededBy = null;
  if (isMemoryKind(opts.kind)) where.kind = opts.kind;
  const ns = opts.namespace?.trim();
  if (ns) where.namespace = ns;

  const rows = await prisma.orgMemory.findMany({
    where,
    orderBy: orderFor(opts.sort),
    take: Math.min(Math.max(1, opts.limit ?? DEFAULT_LIMIT), 500),
  });
  return rows.map(toRow);
}

/**
 * The distinct namespaces an org has used, for the filter dropdown. Cheap (indexed on
 * [orgId, namespace]) and scoped to non-archived, current rows so a dropdown never offers a value
 * that matches nothing. [] when off / unknown org.
 */
export async function listOrgMemoryNamespaces(orgSlug: string): Promise<string[]> {
  if (!isDbConfigured()) return [];
  const prisma = getPrisma();
  const org = await prisma.organization.findUnique({
    where: { slug: normalizeOrgSlug(orgSlug) },
    select: { id: true },
  });
  if (!org) return [];
  const rows = await prisma.orgMemory.findMany({
    where: { orgId: org.id, archived: false, supersededBy: null, namespace: { not: null } },
    select: { namespace: true },
    distinct: ["namespace"],
  });
  return rows
    .map((r) => r.namespace)
    .filter((n): n is string => Boolean(n))
    .sort();
}

/** Fetch one memory (full content). Null if absent. Callers must authorize via getOrgMemoryOrgSlug. */
export async function getOrgMemory(id: string): Promise<MemoryRow | null> {
  if (!isDbConfigured()) return null;
  const m = await getPrisma().orgMemory.findUnique({ where: { id } });
  return m ? toRow(m) : null;
}

/** Resolve the org slug owning a memory, so a per-row route can authorize the caller. Null if absent. */
export async function getOrgMemoryOrgSlug(id: string): Promise<string | null> {
  if (!isDbConfigured()) return null;
  const m = await getPrisma().orgMemory.findUnique({
    where: { id },
    select: { org: { select: { slug: true } } },
  });
  return m?.org.slug ?? null;
}

/**
 * Write a memory. When `supersedeId` is set this is a CORRECTION (design doc §8 "versioning"): the new
 * row is created and, in the SAME transaction, the target is stamped `supersededBy = <new id>` so the
 * old memory leaves default reads while its history survives. The target update is scoped to
 * `{ id, orgId }` — a supersedeId from ANOTHER org matches nothing, and we roll the whole write back
 * (SupersedeTargetNotFoundError) rather than commit a "correction" that corrected nothing.
 *
 * The new row inherits `version = target.version + 1`, so a corrected memory carries its lineage depth.
 */
export async function createOrgMemory(
  orgSlug: string,
  input: MemoryInput,
  createdBy?: string | null,
): Promise<{ id: string } | null> {
  if (!isDbConfigured()) return null;
  const prisma = getPrisma();
  const slug = normalizeOrgSlug(orgSlug);
  const org = await prisma.organization.upsert({
    where: { slug },
    update: {},
    create: { slug, name: slug },
    select: { id: true },
  });

  return prisma.$transaction(async (tx) => {
    let version = 1;
    if (input.supersedeId) {
      // Read the target INSIDE the txn and scoped to this org — the cross-tenant guard.
      const target = await tx.orgMemory.findFirst({
        where: { id: input.supersedeId, orgId: org.id },
        select: { version: true },
      });
      if (!target) throw new SupersedeTargetNotFoundError();
      version = target.version + 1;
    }

    const created = await tx.orgMemory.create({
      data: {
        orgId: org.id,
        content: cleanContent(input.content),
        kind: normalizeMemoryKind(input.kind),
        namespace: cleanNamespace(input.namespace),
        visibility: normalizeMemoryVisibility(input.visibility),
        source: cleanSource(input.source),
        confidence: normalizeConfidence(input.confidence),
        tags: cleanTags(input.tags),
        expiresAt: input.expiresAt ?? null,
        version,
        createdBy: createdBy ?? null,
      },
      select: { id: true },
    });

    if (input.supersedeId) {
      const { count } = await tx.orgMemory.updateMany({
        where: { id: input.supersedeId, orgId: org.id, supersededBy: null },
        data: { supersededBy: created.id },
      });
      // Lost a race to another corrector (already superseded), or the target vanished: abort so we
      // never leave two live rows both claiming to correct the same memory.
      if (count === 0) throw new SupersedeTargetNotFoundError();
    }

    return created;
  });
}

/** Edit a memory. A CONTENT change bumps the version; an archive-only toggle does not (mirrors
 *  updateOrgSkill). Callers authorize first via getOrgMemoryOrgSlug. */
export async function updateOrgMemory(
  id: string,
  patch: Partial<Omit<MemoryInput, "supersedeId">> & { archived?: boolean },
): Promise<void> {
  if (!isDbConfigured()) return;
  const data: Prisma.OrgMemoryUpdateInput = {};
  if (patch.content !== undefined) data.content = cleanContent(patch.content);
  if (patch.kind !== undefined) data.kind = normalizeMemoryKind(patch.kind);
  if (patch.namespace !== undefined) data.namespace = cleanNamespace(patch.namespace);
  if (patch.visibility !== undefined) data.visibility = normalizeMemoryVisibility(patch.visibility);
  if (patch.source !== undefined) data.source = cleanSource(patch.source);
  if (patch.confidence !== undefined) data.confidence = normalizeConfidence(patch.confidence);
  if (patch.tags !== undefined) data.tags = cleanTags(patch.tags);
  if (patch.expiresAt !== undefined) data.expiresAt = patch.expiresAt;
  if (patch.archived !== undefined) data.archived = patch.archived;

  const contentEdit = ["content", "kind", "namespace", "visibility", "source", "confidence", "tags"].some(
    (k) => patch[k as keyof typeof patch] !== undefined,
  );
  if (contentEdit) data.version = { increment: 1 };
  await getPrisma().orgMemory.update({ where: { id }, data });
}

/** Soft-archive a memory (DELETE route) — never a hard delete, so provenance + lineage survive. */
export async function archiveOrgMemory(id: string): Promise<void> {
  if (!isDbConfigured()) return;
  await getPrisma().orgMemory.update({ where: { id }, data: { archived: true } });
}

/**
 * The bounded candidate set the write-intelligence pass reasons over (design doc §8 "write policy":
 * dedup against near-duplicates BEFORE storing). Returns the org's current, visible memories in the
 * SAME namespace (where a duplicate would live), most-recent first and hard-capped — so the prompt the
 * consolidation core builds can never grow with the store. Pure data access: the ranking/judgment lives
 * in src/lib/memory/consolidation.ts, which is what keeps that core framework-agnostic.
 */
export async function candidateOrgMemories(
  orgSlug: string,
  opts: { namespace?: string; kind?: string; limit?: number },
  viewerLogin?: string | null,
): Promise<MemoryRow[]> {
  if (!isDbConfigured()) return [];
  const prisma = getPrisma();
  const org = await prisma.organization.findUnique({
    where: { slug: normalizeOrgSlug(orgSlug) },
    select: { id: true },
  });
  if (!org) return [];

  const where: Prisma.OrgMemoryWhereInput = {
    orgId: org.id,
    archived: false,
    supersededBy: null,
    AND: [notExpired(new Date()), visibilityScope(viewerLogin)],
  };
  const ns = opts.namespace?.trim();
  // A blank namespace means org-wide: compare against the other org-wide memories (namespace IS NULL),
  // not against every namespaced one — otherwise the candidate set is the whole store.
  where.namespace = ns ? ns : null;

  const rows = await prisma.orgMemory.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    take: Math.min(Math.max(1, opts.limit ?? 50), 100),
  });
  return rows.map(toRow);
}

/**
 * Best-effort: bump a memory's recall tally (the `accessCount` sort key). Mirrors recordSkillDownload's
 * fire-and-forget contract — a counter write must never break the read/copy path it decorates.
 */
export async function recordMemoryRecall(id: string): Promise<void> {
  if (!isDbConfigured()) return;
  try {
    await getPrisma().orgMemory.update({
      where: { id },
      data: { accessCount: { increment: 1 } },
    });
  } catch {
    /* usage counting is best-effort — never surface to the caller */
  }
}
