// What the Lessons tab reads once on the server and hands to a composition.
import type { LoopLessonRow } from "@/features/inflight/live/cockpit/loopTypes";

export interface LessonsTabData {
  slug: string;
  lessons: LoopLessonRow[];
  counts: { pending: number; kept: number; discarded: number };
}
