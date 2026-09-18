// THE STANDING RUNNER KEEPS ITS OWN VERIFIED LESSONS — and the operator can take any of them back
// (spark theater-upgrade, 2026-09-18; operator decision Q10).
//
// WHY. A lane's lessons land as pending `OrgMemoryCandidate` rows, and the next lane's brief reads only
// KEPT `OrgMemory` (procedural, the repo's namespace — `lane-brief-read.ts`). A runner that works a
// repository unattended for days therefore never read a word it had learned: every lesson waited in
// an inbox nobody was watching. So a RUNNER lane whose guard verdict was `verified` (the lane decides
// that and passes `autoKeep`) keeps its lessons itself.
//
// WHAT IS KEPT, AND HOW. Exactly what a human keep writes, through the same door (`createOrgMemory`),
// with the provenance saying who decided:
//   • the memory: `source` = LOOP_LESSON_SOURCE (it IS a loop lesson), `createdBy` = RUNNER_KEEPER,
//     `tags` = [RUNNER_KEPT_TAG], `confidence` = RUNNER_KEPT_CONFIDENCE — the "probable, unverified"
//     band, the one an agent-CLAIMED repo memory carries. A verified guard proves the code did not
//     regress; it does not prove the sentence is true, so a human keep (confidence 1.0) outranks it.
//   • the candidate: `kept`, `reviewedBy` = RUNNER_KEEPER, `promotedMemoryId` = the new row.
//   • an `org_memory.created` audit row, so an unattended write into memory is in the audit log.
// RUNNER_KEEPER contains spaces, which a GitHub login cannot, so it can never be mistaken for — or
// collide with — a real reviewer or author.
//
// WHAT IT DELIBERATELY DOES NOT DO.
//   • It never supersedes. The consolidation core's deterministic pass (`analyzeWrite` with no model —
//     no LLM spend on an unattended path) runs against the namespace's live memories; a `duplicate`
//     verdict leaves the candidate PENDING for a human, and a `supersede` verdict is written beside
//     the existing memory, never over it. Retiring what a human kept is a human's call.
//   • It never half-writes. The memory is created first, then the candidate is settled with a
//     `status: "pending"` constraint; if that settle fails the new memory is archived again and the
//     candidate stays pending. A failure anywhere leaves the lesson pending — never lost.
//
// REVOCABLE. `revokeRunnerKeptLesson` archives the memory (soft, via `archiveOrgMemories`) and marks
// the candidate `discarded` by the revoking human — discarded, not back to pending, because a revoke is
// the operator's verdict on that lesson and re-queuing it would ask them the same question twice. The
// candidate keeps `promotedMemoryId`, so the trail to the archived memory survives.

import { dbReadSafe, getPrisma, isDbConfigured } from "@/lib/db/client";
import { getOrgBySlug } from "@/lib/db/org-shared";
import { candidateOrgMemories, createOrgMemory } from "@/lib/db/org-memory";
import { archiveOrgMemories } from "@/lib/db/org-memory-lifecycle";
import { recordAudit } from "@/lib/db/scans-audit";
import { analyzeWrite, type MemoryCandidate } from "@/lib/memory/consolidation";
import { LOOP_LESSON_SOURCE, type CandidateRow, type LoopLessonRow } from "@/lib/db/loop-lessons-row";

/** Who kept a runner lesson — the `reviewedBy` of the candidate and the `createdBy` of the memory. */
export const RUNNER_KEEPER = "the standing runner";
/** The tag on every memory the runner kept, so the Memory tab shows it on the card. */
export const RUNNER_KEPT_TAG = "runner-kept";
/** "Medium: probable, unverified" (`CONFIDENCE_BANDS`) — see the header. */
export const RUNNER_KEPT_CONFIDENCE = 0.6;

/**
 * Keep each freshly recorded candidate into memory. Never throws; returns every row as it now stands
 * (`kept` when it reached memory, unchanged `pending` when it did not). Rows are handled one by one
 * and each kept memory joins the comparison set, so two near-identical lessons from one lane do not
 * both get in.
 */
export async function autoKeepRunnerLessons(orgSlug: string, orgId: string, rows: readonly LoopLessonRow[]): Promise<LoopLessonRow[]> {
  const known = new Map<string, MemoryCandidate[]>();
  const out: LoopLessonRow[] = [];
  for (const row of rows) out.push(await keepOne(orgSlug, orgId, row, known).catch(() => row));
  return out;
}

async function keepOne(orgSlug: string, orgId: string, row: LoopLessonRow, known: Map<string, MemoryCandidate[]>): Promise<LoopLessonRow> {
  const namespace = row.namespace ?? undefined;
  let pool = known.get(row.namespace ?? "");
  if (!pool) {
    // Unreadable comparison set = no keep. The check is the condition, not a nicety.
    const read = await candidateOrgMemories(orgSlug, { namespace, kind: row.kind, limit: 100 }, null).catch(() => null);
    if (!read) return row;
    pool = [...read];
    known.set(row.namespace ?? "", pool);
  }
  const verdict = await analyzeWrite({ content: row.content, kind: row.kind, namespace, candidates: pool }, null);
  if (verdict.recommendation === "duplicate") return row;

  const created = await createOrgMemory(
    orgSlug,
    { content: row.content, kind: row.kind, namespace, source: LOOP_LESSON_SOURCE, tags: [RUNNER_KEPT_TAG], confidence: RUNNER_KEPT_CONFIDENCE },
    RUNNER_KEEPER,
  ).catch(() => null);
  if (!created) return row;

  const reviewedAt = new Date();
  const settled = await getPrisma()
    .orgMemoryCandidate.updateMany({
      where: { id: row.id, orgId, status: "pending" },
      data: { status: "kept", reviewedBy: RUNNER_KEEPER, reviewedAt, promotedMemoryId: created.id },
    })
    .catch(() => ({ count: 0 }));
  if (settled.count === 0) {
    // NEVER HALF-WRITTEN: a memory with no kept candidate behind it is a belief nobody recorded
    // deciding. Take it back out; the candidate stays pending for a human.
    await archiveOrgMemories(orgSlug, [created.id]).catch(() => 0);
    return row;
  }
  pool.push({ id: created.id, content: row.content, kind: row.kind, confidence: RUNNER_KEPT_CONFIDENCE });
  await recordAudit(
    "org_memory.created",
    { memoryId: created.id, kind: row.kind, supersededId: null, keptBy: RUNNER_KEEPER, candidateId: row.id, laneId: row.laneId },
    { orgId },
  ).catch(() => false);
  return { ...row, status: "kept", reviewedBy: RUNNER_KEEPER, reviewedAt: reviewedAt.toISOString(), promotedMemoryId: created.id };
}

/** `kept` = live in memory; `revoked` = the operator took it back; `archived` = the memory row was
 *  archived some other way (the Memory tab, the forget verb) — out of the brief, but never revoked. */
export type RunnerKeptState = "kept" | "revoked" | "archived";

/** One runner-kept lesson as the ledger reads it (`GET /api/org/loop/lessons` → `runnerKept`). */
export interface RunnerKeptLessonRow {
  /** The CANDIDATE id — what `POST /api/org/loop/lessons { action: "revoke" }` takes. */
  id: string;
  /** The repository the lesson is about (the candidate's namespace); null = org-wide. */
  repo: string | null;
  content: string;
  laneId: string | null;
  /** The OrgMemory row the runner wrote (archived, never deleted, once revoked). */
  memoryId: string;
  state: RunnerKeptState;
  /** When the runner kept it — the memory row's creation. ISO. */
  keptAt: string;
  revokedBy: string | null;
  revokedAt: string | null;
  /** When the lane proposed it. ISO. */
  createdAt: string;
}

type MemoryStamp = { id: string; createdBy: string | null; createdAt: Date; archived: boolean };

function toRunnerRow(c: CandidateRow, m: MemoryStamp): RunnerKeptLessonRow {
  const revoked = c.status === "discarded";
  return {
    id: c.id,
    repo: c.namespace,
    content: c.content,
    laneId: c.laneId,
    memoryId: m.id,
    state: revoked ? "revoked" : m.archived ? "archived" : "kept",
    keptAt: m.createdAt.toISOString(),
    revokedBy: revoked ? c.reviewedBy : null,
    revokedAt: revoked && c.reviewedAt ? c.reviewedAt.toISOString() : null,
    createdAt: c.createdAt.toISOString(),
  };
}

/**
 * The lessons the runner kept (and those since revoked), newest decision first. `since` bounds the
 * LAST decision on the row — the keep, or the revoke — so "since you left" returns both.
 *
 * A candidate qualifies when it is kept by RUNNER_KEEPER, or discarded while carrying a promoted
 * memory (the revoke's shape); the join then requires the memory's own `createdBy` to be RUNNER_KEEPER,
 * so a human keep can never be listed here, whatever happened to its candidate later.
 */
export async function listRunnerKeptLessons(
  orgSlug: string,
  opts: { since?: Date | null; limit?: number } = {},
): Promise<RunnerKeptLessonRow[]> {
  if (!isDbConfigured()) return [];
  return dbReadSafe<RunnerKeptLessonRow[]>(async () => {
    const org = await getOrgBySlug(orgSlug);
    if (!org) return [];
    const prisma = getPrisma();
    const candidates = (await prisma.orgMemoryCandidate.findMany({
      where: {
        orgId: org.id,
        source: LOOP_LESSON_SOURCE,
        promotedMemoryId: { not: null },
        OR: [{ status: "kept", reviewedBy: RUNNER_KEEPER }, { status: "discarded" }],
        ...(opts.since ? { reviewedAt: { gte: opts.since } } : {}),
      },
      orderBy: [{ reviewedAt: "desc" }, { id: "asc" }],
      take: Math.max(1, Math.min(200, Math.trunc(opts.limit ?? 50) || 50)),
    })) as CandidateRow[];
    if (candidates.length === 0) return [];
    const memories = (await prisma.orgMemory.findMany({
      where: { orgId: org.id, id: { in: candidates.map((c) => c.promotedMemoryId as string) } },
      select: { id: true, createdBy: true, createdAt: true, archived: true },
    })) as MemoryStamp[];
    const byId = new Map(memories.map((m) => [m.id, m]));
    const out: RunnerKeptLessonRow[] = [];
    for (const c of candidates) {
      const m = byId.get(c.promotedMemoryId as string);
      if (m && m.createdBy === RUNNER_KEEPER) out.push(toRunnerRow(c, m));
    }
    return out;
  }, []);
}

export type RevokeRunnerLessonOutcome =
  | { ok: true; lesson: RunnerKeptLessonRow }
  /** `not-found` = no such candidate IN THIS ORG (gate-then-constrain); `not-runner-kept` = it exists
   *  but the runner did not keep it (pending, a human's keep, already revoked); `failed` = a write
   *  failed — the memory may already be archived, and a retry is safe. */
  | { ok: false; reason: "not-found" | "not-runner-kept" | "failed" };

/**
 * Take back a lesson the runner kept — GATE-THEN-CONSTRAIN: the authorized org is passed into every
 * query beside the id, so another organization's candidate is simply not found.
 *
 * The memory is archived FIRST. If the candidate update then fails, the lesson is already out of every
 * brief and the candidate still reads as runner-kept, so a second revoke finishes the job — the
 * failure mode is the conservative one.
 */
export async function revokeRunnerKeptLesson(orgSlug: string, id: string, reviewer: string | null): Promise<RevokeRunnerLessonOutcome> {
  if (!isDbConfigured()) return { ok: false, reason: "not-found" };
  const org = await getOrgBySlug(orgSlug).catch(() => null);
  if (!org) return { ok: false, reason: "not-found" };
  const prisma = getPrisma();
  const row = (await prisma.orgMemoryCandidate.findFirst({ where: { id, orgId: org.id } }).catch(() => null)) as CandidateRow | null;
  if (!row) return { ok: false, reason: "not-found" };
  const memoryId = row.promotedMemoryId;
  if (row.status !== "kept" || row.reviewedBy !== RUNNER_KEEPER || !memoryId) return { ok: false, reason: "not-runner-kept" };

  const archived = await archiveOrgMemories(orgSlug, [memoryId]).then(() => true, () => false);
  if (!archived) return { ok: false, reason: "failed" };
  const revokedAt = new Date();
  const settled = await prisma.orgMemoryCandidate
    .updateMany({
      where: { id, orgId: org.id, status: "kept", reviewedBy: RUNNER_KEEPER },
      data: { status: "discarded", reviewedBy: reviewer, reviewedAt: revokedAt },
    })
    .catch(() => ({ count: 0 }));
  if (settled.count === 0) return { ok: false, reason: "failed" };
  await recordAudit(
    "org_memory.archived",
    { memoryId, via: "runner-lesson-revoke", candidateId: id },
    { orgId: org.id, actorId: reviewer ?? undefined },
  ).catch(() => false);
  const memory = (await prisma.orgMemory
    .findFirst({ where: { id: memoryId, orgId: org.id }, select: { id: true, createdBy: true, createdAt: true, archived: true } })
    .catch(() => null)) as MemoryStamp | null;
  const stamp: MemoryStamp = memory ?? { id: memoryId, createdBy: RUNNER_KEEPER, createdAt: row.reviewedAt ?? row.createdAt, archived: true };
  return { ok: true, lesson: toRunnerRow({ ...row, status: "discarded", reviewedBy: reviewer, reviewedAt: revokedAt }, stamp) };
}
