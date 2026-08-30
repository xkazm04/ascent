"use client";

// LESSON CANDIDATES — what the loop's agents say this organization's repositories taught them, held
// where a human decides.
//
// The label is the point of the panel. A row here is NOT in Org Memory, and it says so in as many
// words: the companion, the lane brief and every consolidation pass read memory as truth, so a
// remediation agent writing into it directly would let one bad session teach the whole organization
// something nobody agreed to. Keep promotes through the same memory door a person's own write uses;
// Discard is soft, because "this was proposed and rejected" is worth as much as "this was kept".

import { useCallback, useEffect, useState } from "react";
import { Kicker } from "@/components/ui";
import { InlineEmpty, TILE_LEDGER } from "@/components/org/shared/ui";
import { timeAgo } from "@/lib/ui";
import { fetchLoopLessons, settleLoopLesson } from "./loopClient";
import type { LoopLessonRow } from "./loopTypes";

export interface CockpitLessonsProps {
  slug: string;
  /** Server-rendered candidates, when a caller already has them. Omitted, the panel fetches. */
  initial?: LoopLessonRow[] | null;
}

export function CockpitLessons({ slug, initial = null }: CockpitLessonsProps) {
  const [lessons, setLessons] = useState<LoopLessonRow[]>(initial ?? []);
  const [loaded, setLoaded] = useState(initial != null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initial != null) return;
    let alive = true;
    void fetchLoopLessons(slug)
      .then((rows) => {
        if (alive) setLessons(rows);
      })
      .catch(() => null)
      .finally(() => {
        if (alive) setLoaded(true);
      });
    return () => {
      alive = false;
    };
  }, [slug, initial]);

  const settle = useCallback(
    async (id: string, action: "keep" | "discard") => {
      setBusy(id);
      setError(null);
      try {
        await settleLoopLesson(slug, id, action);
        // Settled candidates leave the PENDING list — this panel is the queue, not the archive.
        setLessons((rows) => rows.filter((r) => r.id !== id));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not settle that lesson.");
      } finally {
        setBusy(null);
      }
    },
    [slug],
  );

  if (!loaded) return null;

  return (
    <section aria-label="Lesson candidates" className="mt-4">
      <Kicker tone="muted">Lesson candidates</Kicker>
      {lessons.length === 0 ? (
        <InlineEmpty>No lessons are waiting for review.</InlineEmpty>
      ) : (
        <>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">
            Written by a loop agent, and <strong className="font-semibold text-slate-400">not in memory until you keep one</strong>.
            Keeping runs the same duplicate check any memory write does.
          </p>
          <ul className={`mt-2 ${TILE_LEDGER}`}>
            {lessons.map((l) => (
              <LessonRow key={l.id} lesson={l} busy={busy === l.id} onSettle={settle} />
            ))}
          </ul>
        </>
      )}
      {error && <p className="mt-2 font-mono text-xs text-danger">{error}</p>}
    </section>
  );
}

function LessonRow({
  lesson,
  busy,
  onSettle,
}: {
  lesson: LoopLessonRow;
  busy: boolean;
  onSettle: (id: string, action: "keep" | "discard") => void;
}) {
  return (
    <li className="bg-ink px-4 py-3">
      <p className="text-sm leading-relaxed text-slate-300">{lesson.content}</p>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <span className="font-mono text-xs text-slate-600">
          {lesson.namespace ?? "org-wide"} · {lesson.kind} · {timeAgo(lesson.createdAt)}
        </span>
        <span className="flex items-center gap-3 font-mono text-xs">
          <button
            type="button"
            disabled={busy}
            onClick={() => onSettle(lesson.id, "keep")}
            className="focus-ring rounded text-accent hover:text-accent-soft disabled:opacity-50"
          >
            Keep
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => onSettle(lesson.id, "discard")}
            className="focus-ring rounded text-slate-500 hover:text-slate-300 disabled:opacity-50"
          >
            Discard
          </button>
        </span>
      </div>
    </li>
  );
}
