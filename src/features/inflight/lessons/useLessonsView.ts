"use client";

// The Lessons ledger's state: ONE hook both compositions (LessonsWorklist v1, .v2) call, so Altimeter and
// Prism cannot drift on filters, selection or how a keep/discard settles.
import { useState } from "react";
import { settleLoopLesson } from "@/features/inflight/live/cockpit/loopClient";
import type { LoopLessonRow } from "@/features/inflight/live/cockpit/loopTypes";
import { applyLessonFilters, emptyLessonFilters, settledStatus, type LessonAction, type LessonFilters } from "./lessonsModel";

export function useLessonsView({ org, initial }: { org: string; initial: LoopLessonRow[] }) {
  const [lessons, setLessons] = useState<LoopLessonRow[]>(initial);
  const [filters, setFilters] = useState<LessonFilters>(emptyLessonFilters);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const shown = applyLessonFilters(lessons, filters);

  // One POST per candidate, in order. A refusal leaves that row in the queue and says why: nothing
  // was settled, so nothing may look settled.
  const settle = async (rows: LoopLessonRow[], action: LessonAction) => {
    setError(null);
    for (const r of rows) {
      setBusy(r.id);
      try {
        const updated = await settleLoopLesson(org, r.id, action);
        setLessons((ls) => ls.map((l) => (l.id === r.id ? { ...l, ...updated, status: settledStatus(action) } : l)));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not settle that lesson.");
      }
    }
    setBusy(null);
  };

  return { lessons, filters, setFilters, selected, setSelected, busy, error, shown, settle };
}
