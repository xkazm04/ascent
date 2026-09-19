// The Lessons queue's model — pure. A lesson candidate is what a loop agent says a repository taught
// it, held as `pending` until a human keeps it (promoted through the memory door) or discards it
// (soft — the row stays, so a rejected proposal never looks novel again). See src/lib/db/loop-lessons.ts.

import type { LoopLessonRow } from "@/features/inflight/live/cockpit/loopTypes";

export type LessonAction = "keep" | "discard";

/** A candidate with no namespace applies to the whole organization. */
export const ORG_WIDE = "org-wide";

export interface LessonFilters {
  namespaces: Set<string>;
  kinds: Set<string>;
  /** false = the review queue (pending); true = the settled archive (kept + discarded). */
  archive: boolean;
  query: string;
}

export const emptyLessonFilters = (): LessonFilters => ({ namespaces: new Set(), kinds: new Set(), archive: false, query: "" });

export const isPendingLesson = (r: Pick<LoopLessonRow, "status">): boolean => r.status === "pending";

export const settledStatus = (a: LessonAction): "kept" | "discarded" => (a === "keep" ? "kept" : "discarded");

export const lessonNamespace = (r: Pick<LoopLessonRow, "namespace">): string => r.namespace ?? ORG_WIDE;

export function lessonFiltersActive(f: LessonFilters): boolean {
  return f.namespaces.size > 0 || f.kinds.size > 0 || f.archive || f.query.trim().length > 0;
}

export function applyLessonFilters(rows: readonly LoopLessonRow[], f: LessonFilters): LoopLessonRow[] {
  const q = f.query.trim().toLowerCase();
  return rows.filter((r) => {
    if (f.archive === isPendingLesson(r)) return false;
    if (f.namespaces.size > 0 && !f.namespaces.has(lessonNamespace(r))) return false;
    if (f.kinds.size > 0 && !f.kinds.has(r.kind)) return false;
    if (q && !`${r.content} ${lessonNamespace(r)} ${r.kind}`.toLowerCase().includes(q)) return false;
    return true;
  });
}

export function lessonCounts(rows: readonly Pick<LoopLessonRow, "status">[]): { pending: number; kept: number; discarded: number } {
  let pending = 0;
  let kept = 0;
  let discarded = 0;
  for (const r of rows) {
    if (r.status === "pending") pending += 1;
    else if (r.status === "kept") kept += 1;
    else if (r.status === "discarded") discarded += 1;
  }
  return { pending, kept, discarded };
}
