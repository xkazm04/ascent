// Org Skills Library (Feature 2) — CRUD + server-side filter/sort + adoption + download counter behind
// /api/org/skills. Mirrors the Playbook stack (src/lib/db/playbooks.ts) but adds a `category` filter
// and a denormalized `downloadCount` for cheap DB-side sort-by-most-used (§8.8). `tags` is stored as a
// JSON string[]; this module is the single place skill fields are (de)serialized + bounded. DISTINCT
// from src/lib/db/skill-history.ts (the per-repo onboarding-SKILL.md generation log) — no coupling.

import { Prisma } from "@prisma/client";
import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { getOrgId } from "@/lib/db/org-rollup";
import { isSkillCategory, normalizeSkillCategory } from "@/lib/org/skill-categories";
import { effectiveSkillFrontmatter, type SkillFrontmatter } from "@/lib/org/skill-frontmatter";
import { isLegacyDigest } from "@/lib/registry/catalog";
import { contentDigest, legacyRawDigest } from "@/lib/registry/parse";

/** How the list is ordered. `recent` (default) = last edited; `downloads` = most used. */
export type SkillSort = "name" | "recent" | "downloads";

export interface SkillRow {
  id: string;
  name: string;
  description: string;
  content: string;
  category: string;
  tags: string[];
  /**
   * The frontmatter contract this skill EFFECTIVELY declares, resolved at read time: the document's own
   * block when it has one, otherwise derived from the columns above (rows written before the contract
   * existed still render + still download as a conformant SKILL.md). Never written back to `content`.
   */
  frontmatter: SkillFrontmatter;
  /** Bumped on each content edit — the change-history anchor. */
  version: number;
  /**
   * The canonical content digest — the sync-manifest change key (diff without shipping the body).
   * `sha256-n1:<hex>`; a bare-hex value is a row written before the digest was versioned and means
   * "not comparable, recompute", never "diverged". See `hashContent` below.
   */
  contentHash: string;
  /** Denormalized rolling download/use tally (the sort key). */
  downloadCount: number;
  /** Distinct repos that have adopted this skill (from the adoption relation count). */
  adoptionCount: number;
  /**
   * WHERE THIS SKILL LIVES (UC2 registry mirror). `"hosted"` = ascent's own table, editable in-app;
   * `"registry"` = a mirror of `skills/<name>/SKILL.md` in the customer's registry repo, which is
   * PR-only — the UI must offer "Open in registry" rather than an edit/archive affordance.
   */
  origin: "hosted" | "registry";
  /** Repo-relative path of the mirrored file. Null for a hosted row. */
  registryPath: string | null;
  /** `version` as declared in the file's frontmatter (a string, unlike the hosted integer `version`). */
  registryVersion: string | null;
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
/**
 * Manifest change key. ONE function, shared with the registry catalog and the mirror rows:
 * `contentDigest` (`@/lib/registry/parse`) — sha256 over the FULL submitted body, line endings folded
 * to LF, tagged `sha256-n1:`. The scope and both trade-offs are pinned in that function's doc; a
 * second copy of the arithmetic here is what created the defect below, so there is deliberately none.
 *
 * WHAT THIS REPLACES: `sha256(cleanContent(s))` — the STORED, `MAX_CONTENT`-capped body, hashed raw.
 * One defect seen twice. (1) It was a third span: the catalog hashed whole files, the mirror hashed
 * capped bodies, and this hashed capped stored content — yet this column is what
 * `listOrgSkillManifest` publishes, so the manifest digest a CLI compares against a catalog digest was
 * computed over different input and their (in)equality said nothing either way. (2) Raw bytes made a
 * CRLF checkout report every artifact diverged forever.
 *
 * TRADE-OFF ACCEPTED HERE SPECIFICALLY: hashing UNCAPPED means two bodies differing only past
 * `MAX_CONTENT` now push as `updated` although the stored bytes are identical — a wasted version bump
 * on a >50KB skill. Hashing the capped span instead would report them `unchanged` and silently drop a
 * real edit, which is the strictly worse failure.
 */
const hashContent = (s: string) => contentDigest(s);

/**
 * The pre-`n1` recipe for THIS column, reproduced exactly (raw bytes over the capped stored content)
 * so a digest written before the change can be recognized rather than mistaken for an edit. See the
 * transition branch in `pushOrgSkill`. Never used to write a new value.
 */
const legacyHashContent = (s: string) => legacyRawDigest(cleanContent(s));

function toRow(s: Prisma.OrgSkillGetPayload<{ include: { _count: { select: { adoptions: true } } } }>): SkillRow {
  const tags = parseTags(s.tags);
  return {
    id: s.id,
    name: s.name,
    description: s.description,
    content: s.content,
    category: s.category,
    tags,
    frontmatter: effectiveSkillFrontmatter(s.content, {
      name: s.name,
      description: s.description,
      category: s.category,
      tags,
    }),
    version: s.version,
    contentHash: s.contentHash,
    downloadCount: s.downloadCount,
    adoptionCount: s._count.adoptions,
    // Read defensively: every pre-registry row has the column default, and anything that is not
    // literally "registry" is by definition still ascent's to write.
    origin: s.origin === "registry" ? "registry" : "hosted",
    registryPath: s.registryPath ?? null,
    registryVersion: s.registryVersion ?? null,
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

/** One adoption row WITH its timestamp — the anchor the adoption→outcome loop pairs scans around
 *  (src/lib/org/skill-outcomes.ts). getOrgSkillAdoption's map is deliberately timestamp-less (it only
 *  answers "which repos"), so this is the richer read rather than a widening of that shape. */
export interface SkillAdoptionRow {
  skillId: string;
  repoFullName: string;
  adoptedAt: string;
}

/** Every skill→repo adoption in the org, oldest first. [] when off / unknown org. */
export async function listOrgSkillAdoptionRows(orgSlug: string): Promise<SkillAdoptionRow[]> {
  if (!isDbConfigured()) return [];
  const orgId = await getOrgId(orgSlug);
  if (!orgId) return [];
  const rows = await getPrisma().orgSkillAdoption.findMany({
    where: { orgId },
    orderBy: { adoptedAt: "asc" },
    select: { skillId: true, repoFullName: true, adoptedAt: true },
  });
  return rows.map((r) => ({ skillId: r.skillId, repoFullName: r.repoFullName, adoptedAt: r.adoptedAt.toISOString() }));
}

/** Per-(skill, event type) rollup: when that kind of use last happened and how often. Aggregated in the
 *  DB so a chatty `invoke` stream is never shipped row-by-row just to find a max timestamp. */
export interface SkillEventStat {
  skillId: string;
  type: string;
  lastAt: string;
  count: number;
}

/** The raw material of the dormancy verdict (src/lib/org/skill-usage.ts): every live skill's birthday,
 *  its event rollup, and its adoptions. Kept as a pure ROW read so the verdict itself stays a pure,
 *  unit-testable function over data instead of a query. Null when persistence is off. */
export interface SkillUsageRows {
  skills: { id: string; name: string; createdAt: string }[];
  events: SkillEventStat[];
  adoptions: SkillAdoptionRow[];
}

export async function getOrgSkillUsageRows(orgSlug: string): Promise<SkillUsageRows | null> {
  if (!isDbConfigured()) return null;
  const prisma = getPrisma();
  const orgId = await getOrgId(orgSlug);
  if (!orgId) return { skills: [], events: [], adoptions: [] };
  const skills = await prisma.orgSkill.findMany({
    where: { orgId, archived: false },
    orderBy: { name: "asc" },
    select: { id: true, name: true, createdAt: true },
  });
  if (!skills.length) return { skills: [], events: [], adoptions: [] };
  const ids = skills.map((s) => s.id);
  const [grouped, adoptions] = await Promise.all([
    prisma.orgSkillEvent.groupBy({
      by: ["skillId", "type"],
      where: { orgId, skillId: { in: ids } },
      _max: { createdAt: true },
      _count: { _all: true },
    }),
    listOrgSkillAdoptionRows(orgSlug),
  ]);
  return {
    skills: skills.map((s) => ({ id: s.id, name: s.name, createdAt: s.createdAt.toISOString() })),
    events: grouped
      .filter((g) => g._max.createdAt)
      .map((g) => ({ skillId: g.skillId, type: g.type, lastAt: g._max.createdAt!.toISOString(), count: g._count._all })),
    adoptions: adoptions.filter((a) => ids.includes(a.skillId)),
  };
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
  const digest = hashContent(input.content);
  if (digest === existing.contentHash) {
    return { status: "unchanged", id: existing.id, version: existing.version };
  }
  // ── the digest-version transition ──
  // Versioning the digest changed EVERY stored value at once. Without this branch the first push after
  // the change would report `updated` for every skill in every library and bump every version — a
  // fleet-wide "everything diverged" event for content nobody touched, which is the exact failure the
  // normalization was introduced to stop. So: when the stored key predates the `sha256-n1:` tag,
  // re-derive it with the OLD recipe. A match means the body is unchanged; the row is silently
  // re-keyed to the new digest (no version bump, no `updated`) and every row migrates on its own next
  // push. A mismatch falls through to the real update path below, as it should.
  if (isLegacyDigest(existing.contentHash) && legacyHashContent(input.content) === existing.contentHash) {
    await prisma.orgSkill.update({ where: { id: existing.id }, data: { contentHash: digest } });
    return { status: "unchanged", id: existing.id, version: existing.version };
  }
  const updated = await prisma.orgSkill.update({
    where: { id: existing.id },
    data: {
      description: cleanDescription(input.description),
      content: cleanContent(input.content),
      contentHash: digest,
      category: normalizeSkillCategory(input.category),
      tags: cleanTags(input.tags),
      version: { increment: 1 },
    },
    select: { id: true, version: true },
  });
  return { status: "updated", id: updated.id, version: updated.version };
}

/**
 * The closed set of usage events. `invoke` was retired on 2026-07-29: it ranked highest in the dormancy
 * verdict yet had NO producer anywhere in the app, the CLI, or the hooks — so the only signal that could
 * mark a skill `active` was unproducible, and every skill in the library eventually read "dormant". A
 * documented-but-unemittable event type is worse than none. Legacy rows are rewritten to `download` by
 * prisma/migrations/20260729150000_retire_skill_invoke_event.
 */
export type SkillEventType = "download" | "sync";
export function isSkillEventType(v: string): v is SkillEventType {
  return v === "download" || v === "sync";
}
export interface SkillEventInput {
  skillId: string;
  type: SkillEventType;
  repo?: string | null;
  source?: string | null;
}

/**
 * Record a BATCH of usage events (the telemetry endpoint). Events are filtered to skills that actually
 * belong to `orgSlug` — the tenant boundary, and it drops forged/unknown ids. A real use (`download`)
 * additionally bumps the rolling `OrgSkillDownload` tally + the denormalized `downloadCount` sort key; a
 * passive `sync` is logged but never inflates "most used". Best-effort throughout (mirrors
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
      if (e.type === "download") useCounts.set(e.skillId, (useCounts.get(e.skillId) ?? 0) + 1);
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
 * Best-effort: record one human use of a skill (a web-UI Copy, or a download that isn't `?count=0`).
 *
 * ONE SIGNAL (2026-07-29): this used to write ONLY the counters, so the card's "N uses" climbed while the
 * dormancy badge beside it — which folds `OrgSkillEvent` — never moved. A skill copied 40 times through
 * the UI rendered "40 uses" and "dormant" inches apart. The `OrgSkillEvent` row is now written in the
 * SAME transaction as the tally bump, so the counter and the badge are derived from the same writes and
 * cannot contradict each other, and `active` is reachable through the path that actually exists today
 * (a web copy/download) rather than through the retired, never-emitted `invoke`.
 *
 * `source` defaults to `web` (the UI is the only caller today); a machine client reporting through
 * /api/org/skills/events goes through recordSkillEvents instead and tags its own source.
 *
 * Still fire-and-forget (mirrors recordQuotaEvent): a use-accounting write must never break the
 * download/copy path, and the whole thing stays in one transaction so the sort key can't drift.
 */
export async function recordSkillDownload(
  skillId: string,
  opts: { repo?: string | null; source?: string | null } = {},
): Promise<void> {
  if (!isDbConfigured()) return;
  try {
    const prisma = getPrisma();
    // OrgSkillEvent.orgId is denormalized for the org-scoped rollup, so the owning org has to be read
    // before the write. An unknown skill is a no-op rather than an orphan counter row.
    const skill = await prisma.orgSkill.findUnique({ where: { id: skillId }, select: { orgId: true } });
    if (!skill) return;
    const now = new Date();
    await prisma.$transaction([
      prisma.orgSkillEvent.create({
        data: {
          skillId,
          orgId: skill.orgId,
          type: "download" satisfies SkillEventType,
          repo: opts.repo ?? null,
          source: opts.source ?? "web",
          createdAt: now,
        },
      }),
      prisma.orgSkillDownload.upsert({
        where: { skillId },
        update: { count: { increment: 1 }, lastSeen: now },
        create: { skillId, count: 1 },
      }),
      prisma.orgSkill.update({ where: { id: skillId }, data: { downloadCount: { increment: 1 } } }),
    ]);
  } catch {
    /* usage counting is best-effort — never surface to the download/copy path */
  }
}
