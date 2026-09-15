// The version timeline for one registry skill (#36): what each version changed, and what the runs
// against it taught.
//
// FIRST SIGHT IS THE TRACK. The three facts this timeline used to caption are now its geometry — a
// commit whose version could not be resolved hatches (`not-judged`), a lesson that matches no
// resolved commit is a dashed outline (`declared`), and history older than the read budget is a void
// at the left edge rather than a sentence underneath saying the picture is incomplete. Merging any of
// them into the newest version would look like a fuller history and be an invention.
//
// The grouped list below is the drill-down: the same groups, with each commit and lesson in full.
//
// Server-safe (no hooks): pure presentation over the fold.

import { timeAgo } from "@/lib/ui";
import { Legend, StateTrack, type VizState } from "@/components/org/viz";
import { groupLessonsByVersion, traceGroupLabel } from "@/lib/registry/trace";
import { traceLanes } from "./skillTraceViz";
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
  const track = traceLanes(groups, truncated);
  const present: VizState[] = track ? [...new Set(track.rows.flatMap((r) => r.segments.map((s) => s.state)))] : [];

  return (
    <div className="space-y-4">
      {track && (
        <figure>
          <StateTrack
            rows={track.rows}
            start={track.start}
            end={track.end}
            ticks={track.ticks}
            title="Version history"
          />
          <figcaption className="mt-1.5">
            <Legend states={present} />
          </figcaption>
        </figure>
      )}

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
    </div>
  );
}
