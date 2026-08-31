// LESSONS FROM A LANE — what an agent says a repository taught it, held as a CANDIDATE until a human
// decides.
//
// THE ONE RULE THIS MODULE EXISTS TO ENFORCE: the loop never writes `OrgMemory`. Org Memory is what an
// organization believes about itself; a remediation agent that can write into it directly is an
// unattended process editing the corpus every other surface — the companion, the brief above, the
// consolidation gate — reads as truth. One bad session would then teach the whole organization
// something nobody agreed to. So a lesson lands as an `OrgMemoryCandidate` with `status: "pending"`,
// and promotion is a human action through the existing `POST /api/org/memory` door, which runs the
// duplicate/consolidation check that direct writes here would bypass.
//
// `discard` is SOFT. A discarded candidate keeps its row with `status: "discarded"` — knowing that a
// lesson was proposed and rejected is worth as much as knowing it was kept, and a delete would make
// the same proposal look novel the next time an agent had it.

import { dbReadSafe, getPrisma, isDbConfigured } from "@/lib/db/client";
import { getOrgBySlug } from "@/lib/db/org-shared";
import { redBaselineLessonKey } from "@/lib/local/lane-baseline";

/** Where a candidate came from. One value today; the column is `String` so #36's skill-lessons
 *  channel can reuse this table without a migration. */
export const LOOP_LESSON_SOURCE = "loop-lesson";

export type LessonStatus = "pending" | "kept" | "discarded";

const STATUSES: readonly LessonStatus[] = ["pending", "kept", "discarded"];

export const isLessonStatus = (v: unknown): v is LessonStatus =>
  typeof v === "string" && (STATUSES as readonly string[]).includes(v);

/** A lesson candidate as a client reads it. Timestamps are STRINGS — see wire-safe.ts. */
export interface LoopLessonRow {
  id: string;
  namespace: string | null;
  content: string;
  kind: string;
  source: string;
  laneId: string | null;
  status: string;
  /** The OrgMemory row a kept candidate became; null until a human keeps it. */
  promotedMemoryId: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdAt: string;
}

type CandidateRow = {
  id: string;
  namespace: string | null;
  content: string;
  kind: string;
  source: string;
  laneId: string | null;
  status: string;
  promotedMemoryId: string | null;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  createdAt: Date;
};

function toRow(row: CandidateRow): LoopLessonRow {
  return {
    id: row.id,
    namespace: row.namespace,
    content: row.content,
    kind: row.kind,
    source: row.source,
    laneId: row.laneId,
    status: row.status,
    promotedMemoryId: row.promotedMemoryId,
    reviewedBy: row.reviewedBy,
    reviewedAt: row.reviewedAt ? row.reviewedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Ceiling per lane, matching the report parser's own cap — a session that produced fifty "lessons"
 *  produced none, and a review queue nobody can finish is a review queue nobody reads. */
const MAX_PER_LANE = 5;
const LESSON_MAX_CHARS = 600;

/**
 * Record a lane's lessons as pending candidates. Returns what was written.
 *
 * Deliberately NOT deduplicated against existing memory here: that check belongs to the promotion
 * door, which runs the real consolidation analysis. Skipping a candidate because it looked similar
 * would silently drop the one a human might have wanted to supersede with.
 */
export async function recordLoopLessons(
  orgSlug: string,
  repoFullName: string,
  laneId: string,
  lessons: readonly string[],
): Promise<LoopLessonRow[]> {
  if (!isDbConfigured()) return [];
  const clean = lessons.map((l) => l.trim()).filter(Boolean).slice(0, MAX_PER_LANE);
  if (clean.length === 0) return [];
  const org = await getOrgBySlug(orgSlug).catch(() => null);
  if (!org) return [];
  const prisma = getPrisma();
  const written: LoopLessonRow[] = [];
  for (const content of clean) {
    const row = await prisma.orgMemoryCandidate
      .create({
        data: {
          orgId: org.id,
          namespace: repoFullName,
          content: content.slice(0, LESSON_MAX_CHARS),
          kind: "procedural",
          source: LOOP_LESSON_SOURCE,
          laneId,
          status: "pending",
        },
      })
      .catch(() => null);
    if (row) written.push(toRow(row as CandidateRow));
  }
  return written;
}

/**
 * The one lesson the loop writes about ITSELF: a Practice Library starter it declined to reinstall
 * because an earlier lane already dispatched it into this repo (`proposeLaneKind`, rule 2).
 *
 * Same table, same vocabulary, same `pending` gate as every agent lesson — a candidate a human keeps
 * or discards, never a direct `OrgMemory` write. It exists so the operator is not left staring at a
 * backlog lane on a repo whose biggest gap has an obvious starter, wondering why the loop skipped it.
 *
 * IDEMPOTENT, which the agent-lesson path deliberately is not. A skip is a STANDING FACT, not an
 * event: it will be true again on every subsequent run of the same repo, so an event-shaped write
 * would refill the review queue with the same sentence forever. Keyed on (org, namespace, source,
 * content) — the exact row this function would have written — and returns the existing one untouched,
 * including a discarded one: re-proposing a lesson a human already rejected is the same noise.
 */
export async function recordPracticeSkipLesson(
  orgSlug: string,
  repoFullName: string,
  practiceId: string,
  practiceLabel: string,
): Promise<LoopLessonRow | null> {
  if (!isDbConfigured()) return null;
  try {
    const org = await getOrgBySlug(orgSlug);
    if (!org) return null;
    const content = (
      `The loop already installed the "${practiceLabel}" starter (${practiceId}) in ${repoFullName}, so it will not propose that practice for this repo again — ` +
      `even though the starter's file is no longer in the tree. A practice a human or an agent removed or replaced is a standing decision, not a gap to re-raise.`
    ).slice(0, LESSON_MAX_CHARS);
    const prisma = getPrisma();
    const existing = await prisma.orgMemoryCandidate
      .findFirst({ where: { orgId: org.id, namespace: repoFullName, source: LOOP_LESSON_SOURCE, content } })
      .catch(() => null);
    if (existing) return toRow(existing as CandidateRow);
    const row = await prisma.orgMemoryCandidate
      .create({
        data: {
          orgId: org.id,
          namespace: repoFullName,
          content,
          kind: "procedural",
          source: LOOP_LESSON_SOURCE,
          // No lane exists yet: the skip is decided at ARM time, before any lane row is written.
          laneId: null,
          status: "pending",
        },
      })
      .catch(() => null);
    return row ? toRow(row as CandidateRow) : null;
  } catch {
    return null;
  }
}

/**
 * Why a lane's work could NOT be landed into the operator's checkout.
 *
 * The operator asked for `land` and got a branch instead; without this they would have to read a diff
 * (or the lane log of a run that scrolled away) to find out why. Same table, same `pending` gate as
 * every other candidate — the loop never writes Org Memory.
 *
 * IDEMPOTENT ON THE CAUSE, not on the branch. A refusal is a STANDING FACT about this checkout ("your
 * branch has moved on", "you are editing files the lane touched"), and it will be true again on the
 * next run: keying on the branch name would refill the review queue with one row per run — which is
 * exactly what the 21-run campaign would have produced. The branch and the shas live on the lane log,
 * where they belong; the candidate carries the cause.
 */
export async function recordLandRefusalLesson(
  orgSlug: string,
  repoFullName: string,
  cause: string,
): Promise<LoopLessonRow | null> {
  if (!isDbConfigured()) return null;
  try {
    const org = await getOrgBySlug(orgSlug);
    if (!org) return null;
    const content = (
      `The loop could not land ${repoFullName}'s lane branch into the branch your paired checkout is on: ${cause}. ` +
      `Landing is fast-forward only, and it will never reset, stash or switch your branch — the lane's work is safe on its own ` +
      `ascent/loop-… branch, and merging it is yours to do.`
    ).slice(0, LESSON_MAX_CHARS);
    const prisma = getPrisma();
    const existing = await prisma.orgMemoryCandidate
      .findFirst({ where: { orgId: org.id, namespace: repoFullName, source: LOOP_LESSON_SOURCE, content } })
      .catch(() => null);
    if (existing) return toRow(existing as CandidateRow);
    const row = await prisma.orgMemoryCandidate
      .create({
        data: {
          orgId: org.id,
          namespace: repoFullName,
          content,
          kind: "procedural",
          source: LOOP_LESSON_SOURCE,
          laneId: null,
          status: "pending",
        },
      })
      .catch(() => null);
    return row ? toRow(row as CandidateRow) : null;
  } catch {
    return null;
  }
}

/**
 * THE REPOSITORY'S OWN CHECKS ARE FAILING, and the loop noticed.
 *
 * A red baseline turns the degradation guard off on that repository: there is no green measurement to
 * compare against, so nothing the loop commits there can be shown not to have regressed. The lane's
 * brief now leads with the repair (`leadWithRedBaseline`), and this is how the OPERATOR finds out —
 * in the same review queue every other lesson lands in, so it is not one more log line nobody reads.
 *
 * ONE ROW PER REPOSITORY, REFRESHED — the sharpest difference from `recordLoopLessons`. A red
 * baseline is a standing fact that stays true lane after lane, so an event-shaped write would have
 * filed twenty-one identical candidates in the campaign that exposed this. But the fact is not
 * *static* either: "attempt 4, still failing" is a materially different thing to know than "attempt
 * 1", and it is exactly what an operator needs to see. So the row is keyed on a prefix that carries
 * NEITHER the command nor the date nor the count (`redBaselineLessonKey`), and its content is rewritten
 * as the attempt count climbs.
 *
 * A DISCARDED OR KEPT ROW IS LEFT ALONE. A human has already ruled on it; rewriting their reviewed
 * candidate under them — or resurrecting a rejection into the pending queue — is the noise the
 * idempotence exists to prevent. Only a still-`pending` row is refreshed.
 */
export async function recordRedBaselineLesson(
  orgSlug: string,
  repoFullName: string,
  content: string,
): Promise<LoopLessonRow | null> {
  if (!isDbConfigured()) return null;
  try {
    const org = await getOrgBySlug(orgSlug);
    if (!org) return null;
    const body = content.slice(0, LESSON_MAX_CHARS);
    const prisma = getPrisma();
    const key = redBaselineLessonKey(repoFullName);
    const existing = await prisma.orgMemoryCandidate
      .findFirst({
        where: { orgId: org.id, namespace: repoFullName, source: LOOP_LESSON_SOURCE, content: { startsWith: key } },
        orderBy: { createdAt: "desc" },
      })
      .catch(() => null);
    if (existing) {
      const row = existing as CandidateRow;
      if (row.status !== "pending" || row.content === body) return toRow(row);
      const updated = await prisma.orgMemoryCandidate
        .update({ where: { id: row.id }, data: { content: body } })
        .catch(() => null);
      return toRow((updated ?? row) as CandidateRow);
    }
    const created = await prisma.orgMemoryCandidate
      .create({
        data: {
          orgId: org.id,
          namespace: repoFullName,
          content: body,
          kind: "procedural",
          source: LOOP_LESSON_SOURCE,
          // The lane that is about to run is not what the fact is about — the repository is. Keeping
          // the row lane-free is what lets it survive as ONE row across every lane that hits it.
          laneId: null,
          status: "pending",
        },
      })
      .catch(() => null);
    return created ? toRow(created as CandidateRow) : null;
  } catch {
    return null;
  }
}

/** An org's lesson candidates, newest first. `status` filters; omit it for every state. */
export async function listLoopLessons(orgSlug: string, status?: LessonStatus, limit = 50): Promise<LoopLessonRow[]> {
  if (!isDbConfigured()) return [];
  return dbReadSafe<LoopLessonRow[]>(async () => {
    const org = await getOrgBySlug(orgSlug);
    if (!org) return [];
    const rows = await getPrisma().orgMemoryCandidate.findMany({
      where: { orgId: org.id, ...(status ? { status } : {}) },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: Math.max(1, Math.min(200, Math.trunc(limit) || 50)),
    });
    return (rows as CandidateRow[]).map(toRow);
  }, []);
}

/**
 * Settle one candidate — GATE-THEN-CONSTRAIN.
 *
 * The org is authorized by the caller and then passed INTO the update beside the id, so a candidate
 * belonging to another organization is simply not found and the caller gets a 404. Never a read of
 * the row followed by a comparison: that shape leaks existence, and it is one careless early-return
 * away from trusting a caller-supplied id on its own.
 *
 * @returns the settled row, or null when no candidate with that id exists IN THIS ORG.
 */
export async function settleLoopLesson(
  orgSlug: string,
  id: string,
  action: "keep" | "discard",
  reviewer: string | null,
  promotedMemoryId: string | null = null,
): Promise<LoopLessonRow | null> {
  if (!isDbConfigured()) return null;
  const org = await getOrgBySlug(orgSlug).catch(() => null);
  if (!org) return null;
  const prisma = getPrisma();
  const updated = await prisma.orgMemoryCandidate
    .updateMany({
      where: { id, orgId: org.id },
      data: {
        // Soft on both paths: a discarded candidate is a record that the lesson was proposed and
        // rejected, which is as useful as the kept ones.
        status: action === "keep" ? "kept" : "discarded",
        reviewedBy: reviewer,
        reviewedAt: new Date(),
        ...(promotedMemoryId ? { promotedMemoryId } : {}),
      },
    })
    .catch(() => ({ count: 0 }));
  if (updated.count === 0) return null;
  const row = await prisma.orgMemoryCandidate.findUnique({ where: { id } }).catch(() => null);
  return row ? toRow(row as CandidateRow) : null;
}

/** One candidate, org-constrained — the read the promotion path needs before it writes memory. */
export async function getLoopLesson(orgSlug: string, id: string): Promise<LoopLessonRow | null> {
  if (!isDbConfigured()) return null;
  return dbReadSafe<LoopLessonRow | null>(async () => {
    const org = await getOrgBySlug(orgSlug);
    if (!org) return null;
    const row = await getPrisma().orgMemoryCandidate.findFirst({ where: { id, orgId: org.id } });
    return row ? toRow(row as CandidateRow) : null;
  }, null);
}
