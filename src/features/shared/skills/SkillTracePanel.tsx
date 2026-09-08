"use client";

// The Trace disclosure on a registry-origin skill card (#36).
//
// OFFERED ONLY FOR A REGISTRY-ORIGIN SKILL, and the caller enforces that. A hosted skill lives in
// ascent's own table and has no git history at all; offering it a "Trace" that could only ever say
// "no history" would be a promise the shape of the data cannot keep.
//
// Fetched ON OPEN, never on mount: a Skills tab with forty cards would otherwise fire forty
// requests to render a panel nobody expanded.

import { useState } from "react";
import { fetchSkillTrace, type TraceResponse } from "./skillTrace";
import { SkillTraceTimeline } from "./SkillTraceTimeline";

export function SkillTracePanel({ slug, skill }: { slug: string; skill: string }) {
  const [state, setState] = useState<"idle" | "loading" | "done">("idle");
  const [trace, setTrace] = useState<TraceResponse | null>(null);

  async function open(e: React.SyntheticEvent<HTMLDetailsElement>) {
    if (!e.currentTarget.open || state !== "idle") return;
    setState("loading");
    // `fetchSkillTrace` never throws — it returns the same honest `error` shape the route does, so
    // there is exactly one thing to render and no catch branch that could show something else.
    setTrace(await fetchSkillTrace(slug, skill));
    setState("done");
  }

  return (
    <details className="group mt-2" onToggle={open}>
      {/* The description that used to sit beside the word rides on the affordance itself: a
          disclosure names what it opens, it does not need a subtitle to be legible. */}
      <summary
        title="Every version of this skill in the registry, and the lessons each run recorded against it"
        className="flex cursor-pointer list-none items-center gap-1.5 type-mono-sm text-slate-500 transition hover:text-slate-300 [&::-webkit-details-marker]:hidden"
      >
        <span aria-hidden className="text-slate-600 transition-transform group-open:rotate-90">
          ›
        </span>
        Trace
      </summary>

      <div className="mt-2 rounded-lg border border-slate-800 bg-slate-950/40 p-3">
        {state === "loading" && <p className="type-caption text-slate-600">reading history…</p>}

        {state === "done" && trace?.error && (
          // NOT an empty timeline. "This skill has no history" and "we could not read it" are
          // different claims, and only one of them is about the skill.
          <p className="type-caption text-warn">{trace.error}</p>
        )}

        {state === "done" && trace && !trace.error && (
          <>
            {trace.stale && (
              <p className="mb-2 type-caption text-slate-600">
                showing the last history Ascent could read — GitHub is unreachable right now
              </p>
            )}
            <SkillTraceTimeline entries={trace.entries} lessons={trace.lessons} truncated={trace.truncated} />
          </>
        )}
      </div>
    </details>
  );
}
