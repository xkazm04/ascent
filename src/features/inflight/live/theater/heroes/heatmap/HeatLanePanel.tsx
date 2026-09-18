"use client";

// ONE LANE'S PANEL — the repo and its phase in big words over the map of its code. The words answer
// "what is it doing"; the map answers "where". A session that has opened nothing yet shows the map's
// surveyed frame (or the earlier map, cooling) with the words for it, never an empty box.

import { useRef } from "react";
import type { LanePulse } from "@/lib/local/runner-types";
import { HeatEmptyMap } from "./HeatEmptyMap";
import { HeatTreemap } from "./HeatTreemap";
import { panelModel } from "./heatPanelModel";
import type { RepoHeat } from "./heatTypes";
import { useBoxSize } from "./useBoxSize";

const BIG = "min-[2400px]:text-6xl";
const BIGGER = "min-[2400px]:text-7xl";

export function HeatLanePanel({ lane, repo, now, reducedMotion }: { lane: LanePulse | null; repo: RepoHeat | null; now: number; reducedMotion: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const size = useBoxSize(ref);
  const m = panelModel(lane, repo, now);
  const hasMap = (repo?.files.length ?? 0) > 0;
  // A new session that has opened nothing yet, over a map an earlier session drew on this screen.
  const earlier = hasMap && lane != null && m.untouched;
  return (
    <article data-lane={lane?.laneId ?? undefined} data-repo={repo?.repo ?? lane?.repo} className="flex min-h-0 min-w-0 flex-col gap-3">
      <header className="flex min-w-0 flex-col gap-1">
        <div className="flex min-w-0 items-baseline justify-between gap-4">
          <h2 className={`truncate type-display font-semibold text-white ${BIG}`}>{m.repo}</h2>
          {m.diff ? (
            <p className="shrink-0 font-mono type-figure tabular-nums min-[2400px]:text-5xl" title="The lane's worktree diff so far">
              <span className="text-success-soft">+{m.diff.plus}</span> <span className="text-danger">−{m.diff.minus}</span>
              <span className="type-title text-slate-400 min-[2400px]:text-3xl"> in {m.diff.files}</span>
            </p>
          ) : null}
        </div>
        <p className={`flex min-w-0 flex-wrap items-baseline gap-x-3 type-display-lg font-semibold leading-tight ${m.tone} ${BIGGER}`} aria-live="polite">
          <span data-testid="heat-phase">{m.phase}</span>
          {m.inPhase ? <span className="type-title font-normal text-slate-400 min-[2400px]:text-4xl">{m.inPhase}</span> : null}
        </p>
        <p className="h-7 truncate font-mono type-title min-[2400px]:h-12 min-[2400px]:text-4xl" data-testid="heat-touching">
          {m.touching ? (
            <span className={m.touching.kind === "edit" ? "text-orange-300" : "text-accent-soft"}>{m.touching.path}</span>
          ) : earlier ? (
            <span className="font-sans text-slate-400" data-testid="heat-earlier">
              nothing opened yet — the map is earlier work, cooling
            </span>
          ) : null}
        </p>
      </header>
      <div ref={ref} className={`relative min-h-0 flex-1 ${earlier ? "opacity-60" : ""}`} data-map data-earlier={earlier || undefined}>
        {size && hasMap ? <HeatTreemap repo={repo!} size={size} now={now} reducedMotion={reducedMotion} live={m.live} /> : null}
        {!hasMap ? <HeatEmptyMap planning={m.planning} /> : null}
      </div>
      <p className="flex min-w-0 flex-wrap gap-x-4 font-mono type-mono-sm text-slate-400 min-[2400px]:text-2xl">
        {m.extent ? (
          <span>
            <span className="text-slate-200">{m.extent}</span> {m.sinceWords}
          </span>
        ) : (
          <span>{m.sinceWords}</span>
        )}
        {m.timeBox ? <span className="text-amber-300">{m.timeBox}</span> : null}
      </p>
    </article>
  );
}
