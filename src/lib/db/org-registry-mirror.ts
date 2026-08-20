// Mirror-row writers for the registry indexer (UC2). The registry repo is the SOURCE OF TRUTH; these
// rows are the INDEX that keeps every existing read surface (`listOrgSkills`, `listOrgMemories`, the
// practice-shape loaders) working unchanged after the move to git. Pure DB, no GitHub.
//
// Keyed on `(registryId, registryPath)` — the path IS the identity, not the name. A renamed directory
// is a new row plus a soft-archive of the old one, exactly what git did to the file.
//
// Two invariants, and why this is find-then-write rather than `upsert`:
//   1. `OrgSkill` carries @@unique([orgId, name]) and `OrgPracticeShape` @@unique([orgId, slug]). A
//      registry file colliding with an EXISTING HOSTED row must ADOPT that row (flip it to
//      origin = "registry"), never explode on P2002 and abort the whole index pass.
//   2. Vanished paths are ARCHIVED, never deleted: a bad merge that removes a skill must be
//      recoverable, and the adoption/telemetry rows hanging off the id must survive.

import { getPrisma, isDbConfigured } from "@/lib/db/client";

export interface MirrorSkillInput {
  path: string;
  hash: string;
  name: string;
  description: string;
  category: string;
  content: string;
  version: string | null;
  tags?: string[];
}

export interface MirrorMemoryInput {
  path: string;
  hash: string;
  content: string;
  kind: string;
  namespace: string | null;
  confidence: number;
  source: string | null;
  tags?: string[];
}

export interface MirrorPracticeInput {
  path: string;
  hash: string;
  slug: string;
  practiceId: string;
  dimension: string;
  title: string;
  appliesWhen: string;
  content: string;
}

const cap = (s: string, n: number) => s.slice(0, n);

/**
 * The row's `contentHash` IS the file's canonical digest (`input.hash`, from `contentDigest` in
 * `@/lib/registry/parse`) — the same string the catalog entry for this path carries.
 *
 * WHAT THIS REPLACES: `sha256(cap(content, 50_000))` computed here, over the frontmatter-stripped and
 * capped body. That made this row a THIRD digest span beside the catalog's whole-file hash and
 * `org-skills`' capped-stored-content hash — and since `listOrgSkillManifest` publishes this very
 * column as the sync manifest's change key, the two surfaces a consumer compares (catalog vs manifest)
 * were never comparable. Equality across them meant nothing; inequality explained nothing.
 *
 * TRADE-OFF ACCEPTED: the digest no longer describes the stored/served body, it describes the SOURCE
 * FILE. For a registry-origin row that is the right referent — the registry repo is the source of
 * truth and the file is what a consumer re-pulls — but it does mean a frontmatter-only edit changes
 * the manifest key even though the mirrored body is byte-identical. A loud re-pull, not a silent miss.
 */
const rowDigest = (input: { hash: string }) => input.hash;

/** The row this (registryId, registryPath) already indexed, if any. */
async function findByPath(
  table: "orgSkill" | "orgMemory" | "orgPracticeShape",
  registryId: string,
  path: string,
): Promise<{ id: string } | null> {
  const prisma = getPrisma();
  const where = { registryId, registryPath: path };
  if (table === "orgSkill") return prisma.orgSkill.findFirst({ where, select: { id: true } });
  if (table === "orgMemory") return prisma.orgMemory.findFirst({ where, select: { id: true } });
  return prisma.orgPracticeShape.findFirst({ where, select: { id: true } });
}

/** Upsert one `skills/<name>/SKILL.md` mirror row. Returns the row id, or null when persistence is off. */
export async function upsertRegistrySkill(
  orgId: string,
  registryId: string,
  input: MirrorSkillInput,
): Promise<string | null> {
  if (!isDbConfigured()) return null;
  const prisma = getPrisma();
  const content = cap(input.content, 50_000);
  const data = {
    orgId,
    name: cap(input.name, 200),
    description: cap(input.description, 1000),
    content,
    category: input.category,
    tags: JSON.stringify((input.tags ?? []).slice(0, 20)),
    contentHash: rowDigest(input),
    archived: false,
    origin: "registry",
    registryId,
    registryPath: input.path,
    registryHash: input.hash,
    registryVersion: input.version,
  };

  const existing =
    (await findByPath("orgSkill", registryId, input.path)) ??
    // Name collision with a row this registry has not claimed yet — the hosted original. Adopt it, so
    // the migration PR landing does not leave a duplicate beside the row people already reference.
    (await prisma.orgSkill.findFirst({ where: { orgId, name: data.name }, select: { id: true } }));

  if (existing) {
    await prisma.orgSkill.update({ where: { id: existing.id }, data });
    return existing.id;
  }
  const created = await prisma.orgSkill.create({ data });
  return created.id;
}

/** Upsert one `memory/<kind>/<slug>.md` mirror row. */
export async function upsertRegistryMemory(
  orgId: string,
  registryId: string,
  input: MirrorMemoryInput,
): Promise<string | null> {
  if (!isDbConfigured()) return null;
  const prisma = getPrisma();
  const data = {
    orgId,
    content: cap(input.content, 20_000),
    kind: input.kind,
    namespace: input.namespace,
    confidence: input.confidence,
    source: input.source,
    tags: JSON.stringify((input.tags ?? []).slice(0, 20)),
    archived: false,
    origin: "registry",
    registryId,
    registryPath: input.path,
    registryHash: input.hash,
  };
  const existing = await findByPath("orgMemory", registryId, input.path);
  if (existing) {
    await prisma.orgMemory.update({ where: { id: existing.id }, data });
    return existing.id;
  }
  const created = await prisma.orgMemory.create({ data });
  return created.id;
}

/** Upsert one `practices/<slug>/PRACTICE.md` mirror row. */
export async function upsertRegistryPractice(
  orgId: string,
  registryId: string,
  input: MirrorPracticeInput,
): Promise<string | null> {
  if (!isDbConfigured()) return null;
  const prisma = getPrisma();
  const content = cap(input.content, 50_000);
  const data = {
    orgId,
    slug: cap(input.slug, 200),
    practiceId: cap(input.practiceId, 100),
    dimension: cap(input.dimension, 20),
    title: cap(input.title, 200),
    appliesWhen: cap(input.appliesWhen, 1000),
    content,
    contentHash: rowDigest(input),
    archived: false,
    origin: "registry",
    registryId,
    registryPath: input.path,
    registryHash: input.hash,
  };
  const existing =
    (await findByPath("orgPracticeShape", registryId, input.path)) ??
    (await prisma.orgPracticeShape.findFirst({ where: { orgId, slug: data.slug }, select: { id: true } }));
  if (existing) {
    await prisma.orgPracticeShape.update({ where: { id: existing.id }, data });
    return existing.id;
  }
  const created = await prisma.orgPracticeShape.create({ data });
  return created.id;
}
