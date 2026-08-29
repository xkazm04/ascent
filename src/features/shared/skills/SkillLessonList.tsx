// The lessons hanging on one version of a skill (#36) — what a run against that method taught.
//
// Every honest null renders as one: a lesson whose heading carried no readable date shows its raw
// heading and no date rather than today's, and a lesson with no project slot simply has none. The
// heading is always available in the title, so a reader can see what the parser was given.
//
// Server-safe (no hooks): pure presentation over the fetched rows.

import type { TraceLessonView } from "./skillTrace";

const day = (iso: string | null) => (iso ? iso.slice(0, 10) : "—");

export function SkillLessonList({ lessons }: { lessons: TraceLessonView[] }) {
  if (!lessons.length) return null;
  return (
    <ul className="mt-2 space-y-2">
      {lessons.map((l) => (
        <li key={l.id} className="rounded-lg border border-slate-800 bg-slate-950/50 px-3 py-2">
          <div className="flex flex-wrap items-baseline gap-x-2 font-mono text-xs text-slate-500">
            <span className="tabular-nums text-slate-400" title={l.headingRaw}>
              {day(l.learnedOn)}
            </span>
            {l.project ? <span className="text-slate-400">{l.project}</span> : null}
            {l.versionUsed ? <span className="text-slate-600">used v{l.versionUsed}</span> : null}
          </div>
          {l.body ? (
            <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap font-mono text-xs text-slate-300">{l.body}</pre>
          ) : (
            <p className="mt-1 font-mono text-xs text-slate-600">no body under this heading</p>
          )}
        </li>
      ))}
    </ul>
  );
}
