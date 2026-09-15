// `RepoMemoryMirror` — the ledger of every `.ai/memory/` entry a scan has seen (moonshot #14).
//
// WHY A LEDGER AND NOT JUST AN OrgMemory WRITE: the mirror has to answer "did we already index this
// exact entry" without re-reading the repo, and "why is this entry NOT in memory" without a log dive.
// So each entry gets a row keyed on (org, repo, path, contentHash) — a deterministic hash of the file,
// so an unchanged entry re-seen on the next scan only bumps `lastSeenAt`, and a one-byte edit is a new
// row rather than a silent overwrite of the old claim. `orgMemoryId` links the OrgMemory row it fed;
// `skipReason` records the entries that did NOT feed one. Nothing is dropped silently.
//
// This module is also where the mirror's GATES resolve, because they are all reads of the same
// (Organization, Repository) pair and belong in the data layer rather than in the orchestrator.
//
// Wire types here declare `string` timestamps (AGENTS.md's wire-safe-dates law) — RepoMemoryEntryRow
// crosses to the Memory tab's dead-ends panel.

import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { normalizeOrgSlug } from "@/lib/db/org-shared";

/** One mirrored entry, as a client may read it. Timestamps are ISO strings, never `Date`. */
export interface RepoMemoryEntryRow {
  id: string;
  repoFullName: string;
  path: string;
  entryId: string | null;
  rawKind: string | null;
  mappedKind: string;
  scope: string | null;
  /** Frontmatter date, VERBATIM repo-authored text — not a timestamp, and deliberately not parsed. */
  entryDate: string | null;
  supersedes: string | null;
  refs: string[];
  body: string;
  headSha: string | null;
  superseded: boolean;
  orgMemoryId: string | null;
  skipReason: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
}

/** What the mirror needs to know before it may write anything. Null when the repo is not mirrorable. */
export interface MirrorTarget {
  orgId: string;
  orgSlug: string;
  /** The org's opt-out flag as stored: null = never chosen (the default, ON); false = opted out. */
  mirrorFlag: boolean | null;
  /** Live mirrored rows already held for this (org, repo) — the per-repo cap's input. */
  liveCount: number;
}

/** The value the mirror writes for one entry. `body` is already capped by the parser. */
export interface MirrorEntryInput {
  path: string;
  contentHash: string;
  entryId: string | null;
  rawKind: string | null;
  mappedKind: string;
  scope: string | null;
  entryDate: string | null;
  supersedes: string | null;
  refs: string[];
  body: string;
  headSha: string | null;
  skipReason: string | null;
}

/** One upserted entry, and whether this scan is the first that saw it (the ingest trigger). */
export interface MirrorUpsertResult {
  id: string;
  path: string;
  contentHash: string;
  entryId: string | null;
  mappedKind: string;
  body: string;
  supersedes: string | null;
  /** True only when the row did not exist before this call — the ONLY case that feeds OrgMemory. */
  isNew: boolean;
}

function parseRefs(raw: string): string[] {
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function toRow(r: {
  id: string;
  repoFullName: string;
  path: string;
  entryId: string | null;
  rawKind: string | null;
  mappedKind: string;
  scope: string | null;
  entryDate: string | null;
  supersedes: string | null;
  refsJson: string;
  body: string;
  headSha: string | null;
  superseded: boolean;
  orgMemoryId: string | null;
  skipReason: string | null;
  firstSeenAt: Date;
  lastSeenAt: Date;
}): RepoMemoryEntryRow {
  return {
    id: r.id,
    repoFullName: r.repoFullName,
    path: r.path,
    entryId: r.entryId,
    rawKind: r.rawKind,
    mappedKind: r.mappedKind,
    scope: r.scope,
    entryDate: r.entryDate,
    supersedes: r.supersedes,
    refs: parseRefs(r.refsJson),
    body: r.body,
    headSha: r.headSha,
    superseded: r.superseded,
    orgMemoryId: r.orgMemoryId,
    skipReason: r.skipReason,
    firstSeenAt: r.firstSeenAt.toISOString(),
    lastSeenAt: r.lastSeenAt.toISOString(),
  };
}

/**
 * Gate 1+2+3 in one read: does this org exist, does it OWN a `Repository` row for this coordinate, and
 * what is its opt-out flag? Null means "not mirrorable" — an anonymous scan, an unknown org, or (the
 * one that matters) an org scanning a THIRD PARTY's public repo, whose agent prose is not this org's to
 * index. Repository ownership is the tenancy boundary, and it is checked here rather than trusted from
 * the caller's coordinate string.
 */
export async function resolveMirrorTarget(
  orgSlug: string,
  repoFullName: string,
): Promise<MirrorTarget | null> {
  if (!isDbConfigured()) return null;
  const slug = normalizeOrgSlug(orgSlug);
  if (!slug || !repoFullName) return null;
  const prisma = getPrisma();
  const org = await prisma.organization.findUnique({
    where: { slug },
    select: { id: true, slug: true, repoMemoryMirror: true },
  });
  if (!org) return null;
  const repo = await prisma.repository.findFirst({
    where: { orgId: org.id, fullName: repoFullName },
    select: { id: true },
  });
  if (!repo) return null;
  const liveCount = await prisma.repoMemoryMirror.count({
    where: { orgId: org.id, repoFullName, superseded: false },
  });
  return { orgId: org.id, orgSlug: org.slug, mirrorFlag: org.repoMemoryMirror, liveCount };
}

/**
 * Idempotent upsert of a batch. The unique key is (orgId, repoFullName, path, contentHash), so:
 *   - an UNCHANGED entry re-seen on the next scan updates nothing but `lastSeenAt` (`@updatedAt`) and
 *     comes back `isNew: false`, which is what makes a second identical scan mirror zero new rows;
 *   - an EDITED entry hashes differently and lands as a new row beside the old one — the format is
 *     append-only and superseding, not editing, is how it retires a claim.
 *
 * Returns one result per input, in input order, so the caller can pair the ingest step to it.
 */
export async function upsertMirrorEntries(
  orgId: string,
  repoFullName: string,
  entries: MirrorEntryInput[],
): Promise<MirrorUpsertResult[]> {
  if (!isDbConfigured() || !orgId || entries.length === 0) return [];
  const prisma = getPrisma();
  const out: MirrorUpsertResult[] = [];
  for (const e of entries) {
    const key = { orgId, repoFullName, path: e.path, contentHash: e.contentHash };
    const existing = await prisma.repoMemoryMirror.findUnique({
      where: { orgId_repoFullName_path_contentHash: key },
      select: { id: true },
    });
    const row = await prisma.repoMemoryMirror.upsert({
      where: { orgId_repoFullName_path_contentHash: key },
      // Re-seen on a later commit: refresh only what the NEW sighting genuinely knows. The parsed
      // fields are a function of (path, body), which the hash already pins, so re-writing them would
      // be a no-op that only risks disagreeing with the hash.
      update: { headSha: e.headSha, skipReason: e.skipReason },
      create: {
        orgId,
        repoFullName,
        path: e.path,
        contentHash: e.contentHash,
        entryId: e.entryId,
        rawKind: e.rawKind,
        mappedKind: e.mappedKind,
        scope: e.scope,
        entryDate: e.entryDate,
        supersedes: e.supersedes,
        refsJson: JSON.stringify(e.refs.slice(0, 20)),
        body: e.body,
        headSha: e.headSha,
        skipReason: e.skipReason,
      },
      select: { id: true },
    });
    out.push({
      id: row.id,
      path: e.path,
      contentHash: e.contentHash,
      entryId: e.entryId,
      mappedKind: e.mappedKind,
      body: e.body,
      supersedes: e.supersedes,
      isNew: !existing,
    });
  }
  return out;
}

/** Link a mirrored row to the OrgMemory row it fed (or record why it fed none). Best-effort. */
export async function linkMirroredMemory(
  id: string,
  link: { orgMemoryId?: string | null; skipReason?: string | null },
): Promise<void> {
  if (!isDbConfigured()) return;
  try {
    await getPrisma().repoMemoryMirror.update({
      where: { id },
      data: {
        ...(link.orgMemoryId !== undefined ? { orgMemoryId: link.orgMemoryId } : {}),
        ...(link.skipReason !== undefined ? { skipReason: link.skipReason } : {}),
      },
    });
  } catch {
    /* the ledger link is decoration on a write that already landed */
  }
}

/**
 * Mark the rows an incoming entry supersedes. Matched on the frontmatter `entryId` within the SAME
 * (org, repo) — a `supersedes: 0003` is a claim about that repo's own numbering, never another repo's.
 * Returns the OrgMemory ids of the rows retired, so the caller can archive them (never hard-delete:
 * memory.md's supersede-not-edit contract).
 */
export async function markSuperseded(
  orgId: string,
  repoFullName: string,
  entryIds: string[],
): Promise<string[]> {
  if (!isDbConfigured() || entryIds.length === 0) return [];
  const prisma = getPrisma();
  const targets = await prisma.repoMemoryMirror.findMany({
    where: { orgId, repoFullName, entryId: { in: entryIds }, superseded: false },
    select: { id: true, orgMemoryId: true },
  });
  if (targets.length === 0) return [];
  await prisma.repoMemoryMirror.updateMany({
    where: { id: { in: targets.map((t) => t.id) } },
    data: { superseded: true },
  });
  return targets.map((t) => t.orgMemoryId).filter((x): x is string => Boolean(x));
}

/** How many live mirrored rows an org holds — the Memory tab's "is there anything here" check. */
export async function countMirrored(
  orgSlug: string,
  opts: { repoFullName?: string } = {},
): Promise<number> {
  if (!isDbConfigured()) return 0;
  const prisma = getPrisma();
  const org = await prisma.organization.findUnique({
    where: { slug: normalizeOrgSlug(orgSlug) },
    select: { id: true },
  });
  if (!org) return 0;
  return prisma.repoMemoryMirror.count({
    where: {
      orgId: org.id,
      superseded: false,
      ...(opts.repoFullName ? { repoFullName: opts.repoFullName } : {}),
    },
  });
}

/**
 * The DEAD ENDS: live mirrored `procedural` rows whose repo-declared kind was a failed approach.
 *
 * This is the read the whole mirror exists for. "Another team already tried this and it didn't work"
 * is the single most expensive thing an org rediscovers, and it is written down in every adopted repo
 * — just not anywhere the next team looks. Filtered on `rawKind`, not `mappedKind`: `procedural` also
 * holds conventions and gotchas, which are advice, not warnings.
 */
export async function listRepoDeadEnds(
  orgSlug: string,
  opts: { limit?: number } = {},
): Promise<RepoMemoryEntryRow[]> {
  if (!isDbConfigured()) return [];
  const prisma = getPrisma();
  const org = await prisma.organization.findUnique({
    where: { slug: normalizeOrgSlug(orgSlug) },
    select: { id: true },
  });
  if (!org) return [];
  const rows = await prisma.repoMemoryMirror.findMany({
    where: {
      orgId: org.id,
      superseded: false,
      mappedKind: "procedural",
      rawKind: { in: ["failed-approach", "failed_approach", "dead-end"] },
    },
    orderBy: { lastSeenAt: "desc" },
    take: Math.min(Math.max(1, opts.limit ?? 24), 100),
  });
  return rows.map(toRow);
}

/**
 * Mirrored EPISODIC rows for one repo — the progress notes the onboarding skill's protocol tells an
 * agent to append after every track. Read by the skill-outcome join (`db/skill-history.ts`).
 */
export async function listRepoProgressNotes(
  orgId: string,
  repoFullName: string,
  limit = 50,
): Promise<RepoMemoryEntryRow[]> {
  if (!isDbConfigured()) return [];
  const rows = await getPrisma().repoMemoryMirror.findMany({
    where: { orgId, repoFullName, superseded: false, mappedKind: "episodic" },
    orderBy: { lastSeenAt: "desc" },
    take: Math.min(Math.max(1, limit), 200),
  });
  return rows.map(toRow);
}
