// THE LESSON CANDIDATE'S ROW SHAPE — the vocabulary `loop-lessons.ts` and `loop-lessons-runner.ts`
// both speak, held in its own module so neither has to import the other to read a row.
//
// Pure relocation out of `loop-lessons.ts` (which re-exports every name here, so no caller changed):
// the runner's auto-keep lives in a sibling module and `recordLoopLessons` calls into it, and a
// sibling that imported the row mapper back out of `loop-lessons.ts` would have been an import cycle.

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

/** The candidate as Prisma hands it back — the `Date` columns the mapper below turns into strings. */
export type CandidateRow = {
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

export function toLessonRow(row: CandidateRow): LoopLessonRow {
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
