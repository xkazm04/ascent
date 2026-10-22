// What the Lessons tab reads once on the server and hands to a composition (v1 Altimeter, v2 Prism).
import type { LoopLessonRow } from "@/features/inflight/live/cockpit/loopTypes";

export interface LessonsTabData {
  slug: string;
  lessons: LoopLessonRow[];
  counts: { pending: number; kept: number; discarded: number };
}
