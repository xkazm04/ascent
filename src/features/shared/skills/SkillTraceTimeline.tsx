// The version timeline for one registry skill (#36): what each version changed, and what the runs
// against it taught.
//
// Two groups are labelled rather than hidden, because both are facts about the READ and not about
// the skill: commits whose version could not be resolved (beyond the blob-read budget) render "—",
// and lessons whose declared version matches no resolved commit sit in their own group saying so.
// Merging either into the newest version would look like a fuller history and be an invention.
//
// Server-safe (no hooks): pure presentation over the fold.

import { timeAgo } from "@/lib/ui";
import { groupLessonsByVersion, traceGroupLabel } from "@/lib/registry/trace";
import type { TraceEntryView, TraceLessonView } from "./skillTrace";
import { SkillLessonList } from "./SkillLessonList";

export function SkillTraceTimeline({
  entries,
  lessons,
  truncated,
}: {
  entries: TraceEntryView[];
  lessons: TraceLessonView[];
  truncated: boolean;
}) {
  const groups = groupLessonsByVersion(entries, lessons);
  if (!groups.length) {
    return <p className="type-body-sm text-slate-500">No commits and no lessons for this skill yet.</p>;
  }
  const byId = new Map(lessons.map((l) => [l.id, l]));

  return (
    <div className="space-y-4">
      {groups.map((g, i) => (
        <section key={`${g.version ?? "unresolved"}-${i}`} className="border-l border-slate-800 pl-3">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className={`type-mono-sm ${g.version ? "text-slate-200" : "text-slate-600"}`}>
              {g.version ? `v${g.version}` : "—"}
            </span>
            <span className="type-caption text-slate-600">{traceGroupLabel(g)}</span>
          </div>

          {g.entries.length > 0 && (
            <ul className="mt-1 space-y-0.5">
              {g.entries.map((e) => (
                <li key={e.sha} className="flex flex-wrap items-baseline gap-x-2 type-caption text-slate-500">
                  <span className="text-slate-400">{e.sha.slice(0, 7)}</span>
                  <span className="text-slate-300">{e.message}</span>
                  <span title={e.authoredAt}>{timeAgo(e.authoredAt)}</span>
                  {/* Null is "GitHub did not attribute this commit to an account", never a name. */}
                  {e.authorLogin ? <span className="text-slate-600">@{e.authorLogin}</span> : null}
                </li>
              ))}
            </ul>
          )}

          <SkillLessonList lessons={g.lessons.map((l) => byId.get(l.id)!).filter(Boolean)} />
        </section>
      ))}

      {truncated && (
        <p className="type-caption text-slate-600">
          older commits exist beyond the read budget — this is the recent end of the history
        </p>
      )}
    </div>
  );
}
