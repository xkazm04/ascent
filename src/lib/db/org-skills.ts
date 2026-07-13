// Org Skills Library (Feature 2) — CRUD + server-side filter/sort + adoption + download counter behind
// /api/org/skills. Mirrors the Playbook stack (src/lib/db/playbooks.ts) but adds a `category` filter
// and a denormalized `downloadCount` for cheap DB-side sort-by-most-used (§8.8). `tags` is stored as a
// JSON string[]; this module is the single place skill fields are (de)serialized + bounded. DISTINCT
// from src/lib/db/skill-history.ts (the per-repo onboarding-SKILL.md generation log) — no coupling.

import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { getOrgId } from "@/lib/db/org-rollup";
import { isSkillCategory, normalizeSkillCategory } from "@/lib/org/skill-categories";

/** How the list is ordered. `recent` (default) = last edited; `downloads` = most used. */
export type SkillSort = "name" | "recent" | "downloads";

export interface SkillRow {
  id: string;
  name: string;
  description: string;
  content: string;
  category: string;
  tags: string[];
  /** Bumped on each content edit — the change-history anchor. */
  version: number;
  /** sha256 hex of `content` — the sync-manifest change key (diff without shipping the body). */
  contentHash: string;
  /** Denormalized rolling download/use tally (the sort key). */
  downloadCount: number;
  /** Distinct repos that have adopted this skill (from the adoption relation count). */
  adoptionCount: number;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SkillInput {
  name: string;
  category: string;
  content: string;
  description?: string;
  tags?: string[];
}

export interface SkillListOpts {
  category?: string;
  search?: string;
  sort?: SkillSort;
}

const MAX_CONTENT = 50_000; // 50KB body cap (bounds storage + the markdown render path)

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

const cleanName = (s: string) => s.trim().slice(0, 200);
const cleanDescription = (s: string | undefined) => (s ?? "").trim().slice(0, 1000);
const cleanContent = (s: string) => s.slice(0, MAX_CONTENT);
/** Manifest change key — hash the STORED (already-capped) content so it matches what a client downloads. */
const hashContent = (s: string) => createHash("sha256").update(cleanContent(s)).digest("hex");

function toRow(s: Prisma.OrgSkillGetPayload<{ include: { _count: { select: { adoptions: true } } } }>): SkillRow {
  return {
    id: s.id,
    name: s.name,
    description: s.description,
    content: s.content,
    category: s.category,
    tags: parseTags(s.tags),
    version: s.version,
    contentHash: s.contentHash,
    downloadCount: s.downloadCount,
    adoptionCount: s._count.adoptions,
    createdBy: s.createdBy,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

/**
 * Server-filtered skill list for an org: orgId + not-archived, plus an optional category filter and a
 * case-insensitive name/description search, ordered by name | recent (default) | downloads. Each row is
 * enriched with its adoption count. The category/archived indexes + the downloadCount column keep this
 * cheap at scale. Null when persistence is off; [] for an unknown org.
 */
export async function listOrgSkills(orgSlug: string, opts: SkillListOpts = {}): Promise<SkillRow[] | null> {
  if (!isDbConfigured()) return null;
  const prisma = getPrisma();
  const orgId = await getOrgId(orgSlug);
  if (!orgId) return [];

  const where: Prisma.OrgSkillWhereInput = { orgId, archived: false };
  if (isSkillCategory(opts.category)) where.category = opts.category;
  const search = opts.search?.trim();
  if (search) {
    where.OR = [
      { name: { contains: search, mode: "insensitive" } },
      { description: { contains: search, mode: "insensitive" } },
    ];
  }

  const orderBy: Prisma.OrgSkillOrderByWithRelationInput =
    opts.sort === "name"
      ? { name: "asc" }
      : opts.sort === "downloads"
        ? { downloadCount: "desc" }
        : { updatedAt: "desc" };

  const rows = await prisma.orgSkill.findMany({
    where,
    orderBy,
    include: { _count: { select: { adoptions: true } } },
  });
  return rows.map(toRow);
}

/** Fetch one skill (full content), for the download/edit path. Null if absent. */
export async function getOrgSkill(id: string): Promise<SkillRow | null> {
  if (!isDbConfigured()) return null;
  const s = await getPrisma().orgSkill.findUnique({
    where: { id },
    include: { _count: { select: { adoptions: true } } },
  });
  return s ? toRow(s) : null;
}

/** Resolve the org slug owning a skill, so a per-row route can authorize the caller. Null if absent. */
export async function getOrgSkillOrgSlug(id: string): Promise<string | null> {
  if (!isDbConfigured()) return null;
  const s = await getPrisma().orgSkill.findUnique({ where: { id }, select: { org: { select: { slug: true } } } });
  return s?.org.slug ?? null;
}

export async function createOrgSkill(
  orgSlug: string,
  input: SkillInput,
  createdBy?: string | null,
): Promise<{ id: string } | null> {
  if (!isDbConfigured()) return null;
  const prisma = getPrisma();
  const org = await prisma.organization.upsert({
    where: { slug: orgSlug },
    update: {},
    create: { slug: orgSlug, name: orgSlug },
    select: { id: true },
  });
  return prisma.orgSkill.create({
    data: {
      orgId: org.id,
      name: cleanName(input.name),
      description: cleanDescription(input.description),
      content: cleanContent(input.content),
      contentHash: hashContent(input.content),
      category: normalizeSkillCategory(input.category),
      tags: cleanTags(input.tags),
      createdBy: createdBy ?? null,
    },
    select: { id: true },
  });
}

/** Edit a skill. A CONTENT change (name/description/content/category/tags) bumps the version; an
 *  archive-only toggle does not (mirror updatePlaybook). */
export async function updateOrgSkill(
  id: string,
  patch: Partial<SkillInput> & { archived?: boolean },
): Promise<void> {
  if (!isDbConfigured()) return;
  const data: Prisma.OrgSkillUpdateInput = {};
  if (patch.name !== undefined) data.name = cleanName(patch.name);
  if (patch.description !== undefined) data.description = cleanDescription(patch.description);
  if (patch.content !== undefined) {
    data.content = cleanContent(patch.content);
    data.contentHash = hashContent(patch.content); // keep the manifest key in lockstep with the body
  }
  if (patch.category !== undefined) data.category = normalizeSkillCategory(patch.category);
  if (patch.tags !== undefined) data.tags = cleanTags(patch.tags);
  if (patch.archived !== undefined) data.archived = patch.archived;
  const contentEdit = ["name", "description", "content", "category", "tags"].some(
    (k) => patch[k as keyof typeof patch] !== undefined,
  );
  if (contentEdit) data.version = { increment: 1 };
  await getPrisma().orgSkill.update({ where: { id }, data });
}

/** Soft-archive a skill (DELETE route) — never a hard delete, so adoption history survives. */
export async function archiveOrgSkill(id: string): Promise<void> {
  if (!isDbConfigured()) return;
  await getPrisma().orgSkill.update({ where: { id }, data: { archived: true } });
}

export interface SkillAdoption {
  repos: number;
  adoptedRepos: string[];
}

/** Adoption map keyed by skill id: which repos marked each skill adopted. Mirrors getPlaybookAdoption
 *  (the lighter half — counts + repo list; no lift metric). {} when off / unknown org. */
export async function getOrgSkillAdoption(orgSlug: string): Promise<Record<string, SkillAdoption>> {
  if (!isDbConfigured()) return {};
  const prisma = getPrisma();
  const orgId = await getOrgId(orgSlug);
  if (!orgId) return {};
  const apps = await prisma.orgSkillAdoption.findMany({
    where: { orgId },
    select: { skillId: true, repoFullName: true },
  });
  const out: Record<string, SkillAdoption> = {};
  for (const a of apps) {
    const e = (out[a.skillId] ??= { repos: 0, adoptedRepos: [] });
    if (!e.adoptedRepos.includes(a.repoFullName)) {
      e.adoptedRepos.push(a.repoFullName);
      e.repos = e.adoptedRepos.length;
    }
  }
  return out;
}

/** Record that a repo adopted a skill (idempotent per skill+repo). False if org/skill unknown —
 *  defense-in-depth alongside the route's authz (the org filter is the tenant boundary). */
export async function adoptOrgSkill(
  orgSlug: string,
  skillId: string,
  repoFullName: string,
  adoptedBy?: string | null,
): Promise<boolean> {
  if (!isDbConfigured()) return false;
  const prisma = getPrisma();
  const orgId = await getOrgId(orgSlug);
  if (!orgId) return false;
  const skill = await prisma.orgSkill.findFirst({ where: { id: skillId, orgId }, select: { id: true } });
  if (!skill) return false;
  await prisma.orgSkillAdoption.upsert({
    where: { skillId_repoFullName: { skillId, repoFullName } },
    update: { adoptedBy: adoptedBy ?? null, adoptedAt: new Date() },
    create: { skillId, orgId, repoFullName, adoptedBy: adoptedBy ?? null },
  });
  return true;
}

/** Remove a skill→repo adoption. */
export async function unadoptOrgSkill(skillId: string, repoFullName: string): Promise<void> {
  if (!isDbConfigured()) return;
  await getPrisma().orgSkillAdoption.deleteMany({ where: { skillId, repoFullName } });
}

/** One light row per non-archived skill for the sync manifest — enough for a client to diff (by
 *  version/contentHash) WITHOUT shipping every body. Null when persistence is off; [] for an unknown org. */
export interface SkillManifestEntry {
  id: string;
  name: string;
  category: string;
  version: number;
  contentHash: string;
  updatedAt: string;
}

export async function listOrgSkillManifest(orgSlug: string): Promise<SkillManifestEntry[] | null> {
  if (!isDbConfigured()) return null;
  const orgId = await getOrgId(orgSlug);
  if (!orgId) return [];
  const rows = await getPrisma().orgSkill.findMany({
    where: { orgId, archived: false },
    orderBy: { name: "asc" },
    select: { id: true, name: true, category: true, version: true, contentHash: true, updatedAt: true },
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    category: r.category,
    version: r.version,
    contentHash: r.contentHash,
    updatedAt: r.updatedAt.toISOString(),
  }));
}

/** Outcome of a CLI/CI `push` (register-or-update by name). `conflict` carries the CURRENT server version
 *  so the client can rebase; `unchanged` means an identical body was re-pushed (idempotent, no bump). */
export type SkillPushResult =
  | { status: "created" | "updated" | "unchanged" | "conflict"; id: string; version: number };

/**
 * Register a skill by name, or update the existing one with optimistic concurrency. When `baseVersion`
 * is supplied and no longer matches the server's version, returns `conflict` (no write) so a stale push
 * can't clobber a newer edit — the CLI's edit-safety guarantee. An identical body (same contentHash) is a
 * no-op `unchanged` so re-running `sync`/`push` never churns the version.
 */
export async function pushOrgSkill(
  orgSlug: string,
  input: SkillInput,
  opts: { baseVersion?: number; createdBy?: string | null } = {},
): Promise<SkillPushResult | null> {
  if (!isDbConfigured()) return null;
  const prisma = getPrisma();
  const org = await prisma.organization.upsert({
    where: { slug: orgSlug },
    update: {},
    create: { slug: orgSlug, name: orgSlug },
    select: { id: true },
  });
  const name = cleanName(input.name);
  const existing = await prisma.orgSkill.findFirst({
    where: { orgId: org.id, name },
    select: { id: true, version: true, contentHash: true },
  });
  if (!existing) {
    const created = await prisma.orgSkill.create({
      data: {
        orgId: org.id,
        name,
        description: cleanDescription(input.description),
        content: cleanContent(input.content),
        contentHash: hashContent(input.content),
        category: normalizeSkillCategory(input.category),
        tags: cleanTags(input.tags),
        createdBy: opts.createdBy ?? null,
      },
      select: { id: true, version: true },
    });
    return { status: "created", id: created.id, version: created.version };
  }
  if (opts.baseVersion !== undefined && opts.baseVersion !== existing.version) {
    return { status: "conflict", id: existing.id, version: existing.version };
  }
  if (hashContent(input.content) === existing.contentHash) {
    return { status: "unchanged", id: existing.id, version: existing.version };
  }
  const updated = await prisma.orgSkill.update({
    where: { id: existing.id },
    data: {
      description: cleanDescription(input.description),
      content: cleanContent(input.content),
      contentHash: hashContent(input.content),
      category: normalizeSkillCategory(input.category),
      tags: cleanTags(input.tags),
      version: { increment: 1 },
    },
    select: { id: true, version: true },
  });
  return { status: "updated", id: updated.id, version: updated.version };
}

export type SkillEventType = "download" | "sync" | "invoke";
export function isSkillEventType(v: string): v is SkillEventType {
  return v === "download" || v === "sync" || v === "invoke";
}
export interface SkillEventInput {
  skillId: string;
  type: SkillEventType;
  repo?: string | null;
  source?: string | null;
}

/**
 * Record a BATCH of usage events (the telemetry endpoint). Events are filtered to skills that actually
 * belong to `orgSlug` — the tenant boundary, and it drops forged/unknown ids. Real uses (download /
 * invoke) additionally bump the rolling `OrgSkillDownload` tally + the denormalized `downloadCount` sort
 * key; a passive `sync` is logged but never inflates "most used". Best-effort throughout (mirrors
 * recordSkillDownload) — telemetry must never fail the caller's real work.
 */
export async function recordSkillEvents(orgSlug: string, events: SkillEventInput[]): Promise<{ recorded: number }> {
  if (!isDbConfigured()) return { recorded: 0 };
  const prisma = getPrisma();
  const orgId = await getOrgId(orgSlug);
  if (!orgId) return { recorded: 0 };
  const ids = Array.from(new Set(events.map((e) => e.skillId).filter(Boolean)));
  if (!ids.length) return { recorded: 0 };
  const owned = await prisma.orgSkill.findMany({ where: { id: { in: ids }, orgId }, select: { id: true } });
  const ownedSet = new Set(owned.map((s) => s.id));
  const valid = events.filter((e) => ownedSet.has(e.skillId) && isSkillEventType(e.type));
  if (!valid.length) return { recorded: 0 };
  const clip = (v?: string | null) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 200) : null);
  try {
    const now = new Date();
    await prisma.orgSkillEvent.createMany({
      data: valid.map((e) => ({ skillId: e.skillId, orgId, type: e.type, repo: clip(e.repo), source: clip(e.source), createdAt: now })),
    });
    const useCounts = new Map<string, number>();
    for (const e of valid) {
      if (e.type === "download" || e.type === "invoke") useCounts.set(e.skillId, (useCounts.get(e.skillId) ?? 0) + 1);
    }
    for (const [skillId, count] of useCounts) {
      await prisma.$transaction([
        prisma.orgSkillDownload.upsert({ where: { skillId }, update: { count: { increment: count }, lastSeen: now }, create: { skillId, count } }),
        prisma.orgSkill.update({ where: { id: skillId }, data: { downloadCount: { increment: count } } }),
      ]);
    }
  } catch {
    /* telemetry is best-effort — never surface to the caller */
  }
  return { recorded: valid.length };
}

/**
 * Best-effort: bump a skill's download/use tally (one rolling row per skill) AND the denormalized
 * `downloadCount` on the skill, in one transaction so the sort key can't drift from the tally. Mirrors
 * recordQuotaEvent's fire-and-forget contract — a counter write must never break the download/copy path.
 */
export async function recordSkillDownload(skillId: string): Promise<void> {
  if (!isDbConfigured()) return;
  try {
    const prisma = getPrisma();
    await prisma.$transaction([
      prisma.orgSkillDownload.upsert({
        where: { skillId },
        update: { count: { increment: 1 }, lastSeen: new Date() },
        create: { skillId, count: 1 },
      }),
      prisma.orgSkill.update({ where: { id: skillId }, data: { downloadCount: { increment: 1 } } }),
    ]);
  } catch {
    /* usage counting is best-effort — never surface to the download/copy path */
  }
}
