// `OrgSkillLesson` — one row per `## ` entry in `skills/<name>/LESSONS.md` (#36).
//
// Mirror rows, not history. The git log is the record; these exist so the lessons are readable,
// groupable by version, and ingestible as memory without a network round trip. When a `LESSONS.md`
// vanishes from the registry its rows are PURGED rather than archived, precisely because they are a
// mirror: keeping them would leave the tab asserting reflections the registry no longer publishes.
//
// `memoryId` is the one field a re-index must never clear. It records that a lesson already produced
// a memory candidate, and clearing it would make every index pass re-ingest every lesson — the flood
// this design exists to avoid.
//
// Not barrel-exported by this module's own initiative (the barrel line is requested at merge).

import { getPrisma, isDbConfigured } from "@/lib/db/client";
import type { LessonEntry } from "@/lib/registry/lessons";

/** One lesson, client-facing: timestamps are ISO strings. */
export interface SkillLessonRow {
  id: string;
  skillName: string;
  registryPath: string;
  /** Heading slot 1, verbatim. `""` = the heading carried no readable version. */
  versionUsed: string;
  /** Null when the heading carried no readable date. Never a substituted "today". */
  learnedOn: string | null;
  project: string;
  headingRaw: string;
  body: string;
  position: number;
  /** The memory candidate this lesson produced, when it has been ingested. */
  memoryId: string | null;
  createdAt: string;
}

function toRow(r: {
  id: string;
  skillName: string;
  registryPath: string;
  versionUsed: string;
  learnedOn: Date | null;
  project: string;
  headingRaw: string;
  body: string;
  position: number;
  memoryId: string | null;
  createdAt: Date;
}): SkillLessonRow {
  return {
    id: r.id,
    skillName: r.skillName,
    registryPath: r.registryPath,
    versionUsed: r.versionUsed,
    learnedOn: r.learnedOn ? r.learnedOn.toISOString() : null,
    project: r.project,
    headingRaw: r.headingRaw,
    body: r.body,
    position: r.position,
    memoryId: r.memoryId,
    createdAt: r.createdAt.toISOString(),
  };
}

/** Lessons for one skill (or the whole org when `skillName` is omitted), in file order. */
export async function listSkillLessons(orgId: string, skillName?: string, limit = 200): Promise<SkillLessonRow[]> {
  if (!isDbConfigured()) return [];
  const rows = await getPrisma().orgSkillLesson.findMany({
    where: { orgId, ...(skillName ? { skillName } : {}) },
    orderBy: [{ skillName: "asc" }, { position: "asc" }],
    take: Math.min(1000, Math.max(1, limit)),
  });
  return rows.map(toRow);
}

/** The newest lessons across the org, for the registry activity feed. */
export async function listRecentLessons(orgId: string, limit = 10): Promise<SkillLessonRow[]> {
  if (!isDbConfigured()) return [];
  const rows = await getPrisma().orgSkillLesson.findMany({
    where: { orgId },
    // `learnedOn` first: it is the lesson's own claim about when the run happened, and it is what a
    // reader means by "recent". Rows with no readable date sort last rather than to the top, which
    // a null-ascending default would do.
    orderBy: [{ learnedOn: "desc" }, { createdAt: "desc" }],
    take: Math.min(50, Math.max(1, limit)),
  });
  return rows.map(toRow);
}

/**
 * Replace one file's lessons. Returns `{ written, removed }`.
 *
 * Per-FILE, delete-not-in-set then upsert on `(registryId, registryPath, entryHash)`: a re-index of
 * the same head writes nothing new, an edited entry replaces itself (its hash changed), and an entry
 * someone removed from the file disappears. The upsert's `update` deliberately omits `memoryId`, so
 * ingestion state survives every re-index.
 */
export async function replaceSkillLessons(
  registryId: string,
  orgId: string,
  skillName: string,
  registryPath: string,
  entries: LessonEntry[],
): Promise<{ written: number; removed: number }> {
  if (!isDbConfigured()) return { written: 0, removed: 0 };
  const prisma = getPrisma();
  const hashes = entries.map((e) => e.entryHash);
  const removed = await prisma.orgSkillLesson.deleteMany({
    where: { registryId, registryPath, ...(hashes.length ? { entryHash: { notIn: hashes } } : {}) },
  });

  let written = 0;
  for (const e of entries) {
    const data = {
      skillName,
      versionUsed: e.versionUsed.slice(0, 200),
      learnedOn: e.learnedOn ? new Date(e.learnedOn) : null,
      project: e.project.slice(0, 200),
      headingRaw: e.headingRaw.slice(0, 500),
      body: e.body,
      position: e.position,
    };
    try {
      await prisma.orgSkillLesson.upsert({
        where: { registryId_registryPath_entryHash: { registryId, registryPath, entryHash: e.entryHash } },
        update: data,
        create: { registryId, orgId, registryPath, entryHash: e.entryHash, ...data },
      });
      written += 1;
    } catch {
      /* one malformed entry degrades itself, never the pass */
    }
  }
  return { written, removed: removed.count };
}

/** Purge every lesson row whose `LESSONS.md` was NOT seen in this pass. An empty `seenPaths` is
 *  honoured (a registry that deleted every lessons file loses every row) — the caller's
 *  truncated-tree guard is what keeps that from firing on a partial read. */
export async function purgeSkillLessons(registryId: string, seenPaths: string[]): Promise<number> {
  if (!isDbConfigured()) return 0;
  const { count } = await getPrisma().orgSkillLesson.deleteMany({
    where: { registryId, ...(seenPaths.length ? { registryPath: { notIn: seenPaths } } : {}) },
  });
  return count;
}

/** Stamp the memory candidate a lesson produced. Best-effort: the ingest is already done. */
export async function setLessonMemoryId(lessonId: string, memoryId: string): Promise<void> {
  if (!isDbConfigured()) return;
  await getPrisma()
    .orgSkillLesson.update({ where: { id: lessonId }, data: { memoryId } })
    .catch(() => {});
}
