"use client";

// Registry history, fetched on open. A missing version stays unresolved. It is never borrowed from a neighbour.
import { useState } from "react";
import { Caption, CellMark, GhostAction, type CellState } from "@/components/kit";
import { timeAgo } from "@/lib/ui";
import { groupLessonsByVersion, traceGroupLabel } from "@/lib/registry/trace";
import { fetchSkillTrace, type TraceResponse } from "./skillTrace";

export function SkillTraceV2({ slug, skill }: { slug: string; skill: string }) {
  const [state, setState] = useState<"idle" | "loading" | "done">("idle");
  const [trace, setTrace] = useState<TraceResponse | null>(null);

  async function open() {
    if (state !== "idle") return;
    setState("loading");
    setTrace(await fetchSkillTrace(slug, skill));
    setState("done");
  }

  return (
    <div className="mt-4 border-t border-divider pt-4">
      {state !== "done" && (
        <GhostAction onClick={open} disabled={state === "loading"} aria-label="Every version of this skill in the registry, and the lessons each run recorded against it">
          {state === "loading" ? "Reading history…" : "Trace"}
        </GhostAction>
      )}
      <Caption className="mt-2">Every version of this skill in the registry, and the lessons each run recorded against it.</Caption>
      {state === "done" && trace?.error && (
        <p role="alert" className="mt-2 type-body-sm text-slate-100">
          <span aria-hidden>! </span>
          {trace.error}
        </p>
      )}
      {state === "done" && trace && !trace.error && <TraceBody trace={trace} />}
    </div>
  );
}

function TraceBody({ trace }: { trace: TraceResponse }) {
  const groups = groupLessonsByVersion(trace.entries, trace.lessons);
  const byId = new Map(trace.lessons.map((l) => [l.id, l]));
  if (!groups.length) return <p className="mt-2 type-body-sm text-slate-400">No commits and no lessons for this skill yet.</p>;
  return (
    <div className="mt-3 space-y-4">
      {trace.stale && <Caption>Showing the last history Ascent could read. GitHub is unreachable right now.</Caption>}
      {trace.truncated && <Caption>Older history was not read in this window.</Caption>}
      {groups.map((g, i) => {
        const unresolved = !g.version;
        const mark: CellState = g.unplaced ? "partial" : unresolved ? "unmeasured" : "met";
        return (
          <section key={`${g.version ?? "unresolved"}-${i}`}>
            <CellMark state={mark}>{traceGroupLabel(g)}</CellMark>
            <ul className="mt-2 space-y-2">
              {g.entries.map((e) => (
                <li key={e.sha}>
                  <p className="type-body-sm text-slate-200">{e.message}</p>
                  <Caption>
                    {e.sha.slice(0, 7)}, {timeAgo(e.authoredAt)}, {e.authoredAt.slice(0, 10)}
                    {e.authorLogin ? `, @${e.authorLogin}` : ""}
                  </Caption>
                </li>
              ))}
            </ul>
            {g.lessons.map((ref) => {
              const l = byId.get(ref.id);
              if (!l) return null;
              return (
                <div key={l.id} className="mt-2 border-t border-divider pt-2">
                  <Caption>
                    {l.learnedOn ? l.learnedOn.slice(0, 10) : "No date"}
                    {l.project ? `, ${l.project}` : ""}
                    {l.versionUsed ? `, used v${l.versionUsed}` : ""}. Heading: {l.headingRaw}
                  </Caption>
                  {l.body ? (
                    <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap type-caption text-slate-200">{l.body}</pre>
                  ) : (
                    <Caption>No body under this heading.</Caption>
                  )}
                </div>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}
