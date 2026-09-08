"use client";

// empty-state-design: a follow-ups region that can settle into five different empties. Each world is a
// context change (the region ghosts, then settles); "nothing here" is rendered only after a response,
// and WHICH nothing is decided by the raw collection, not the filtered one — a user with a filter and
// forty hidden rows is told about the filter, never invited to create their first item. Chrome (the
// filter chip, the world picker) stays through every state.

import { useEffect, useRef, useState } from "react";
import { EMPTY_COPY, LATENCY, emptyCause, type Latency } from "./asyncState";
import { useRequestRegion } from "./asyncHooks";
import { WORLDS, type EmptyWorld } from "./fixtures";
import { BTN, BTN_ON, GhostRows, ROW, Readout, Region, StateChip } from "./sceneParts";

export function EmptyRegion({ reduced, latency }: { reduced: boolean; latency: Latency }) {
  const [world, setWorld] = useState<EmptyWorld>("no-match");
  const region = useRequestRegion<never>();
  const { issue } = region;
  const w = WORLDS.find((x) => x.id === world) ?? WORLDS[0];
  // The dial is read when a world is picked; moving the dial does not re-issue the request.
  const latencyRef = useRef(latency);
  useEffect(() => {
    latencyRef.current = latency;
  });
  // Picking a world is an identifying change: drop, unsettle, ghost, then settle into the new answer.
  useEffect(() => {
    void issue({ rows: [], latencyMs: LATENCY[latencyRef.current] }, { drop: true, tag: world });
  }, [issue, world]);

  const state = region.state(false);
  const cause = emptyCause(w.raw, w.filtered, { prerequisiteMissing: world === "prerequisite", hiddenByRole: world === "permission", queueSemantics: world === "drained" });
  const copy = cause ? EMPTY_COPY[cause] : null;

  return (
    <Region technique="empty-state-design" title="Which nothing?" note="Empty is a claim about the dataset: earned by a response, typed by its cause, proportionate in composition.">
      <div className="flex flex-wrap items-center gap-2" data-chrome>
        <span className={`${BTN_ON} cursor-default`} aria-pressed>
          filter: security
        </span>
        <span className="type-caption text-slate-500">world:</span>
        {WORLDS.map((x) => (
          <button key={x.id} type="button" className={world === x.id ? BTN_ON : BTN} aria-pressed={world === x.id} onClick={() => setWorld(x.id)}>
            {x.label}
          </button>
        ))}
      </div>
      <div className="mt-3 min-h-[6.5rem]" data-content={state} aria-busy={region.inFlight}>
        {state === "loading" ? (
          <GhostRows count={3} reduced={reduced} rowClass={ROW} />
        ) : copy ? (
          <div className={`rounded-lg border border-dashed border-divider px-3 py-3 ${copy.tone === "clear" ? "text-success-soft" : "text-slate-300"}`} data-empty={cause} data-tone={copy.tone}>
            <p className="type-body-sm font-medium">
              {copy.tone === "clear" ? "✓ " : null}
              {copy.title}
            </p>
            <p className="mt-0.5 type-caption text-slate-500">{copy.body}</p>
            {copy.action ? (
              <button type="button" className={`${BTN} mt-2`}>
                {copy.action}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="mt-3 space-y-1">
        <Readout label="raw / filtered" value={`${w.raw} / ${w.filtered}`} />
        <Readout label="settled" value={<span data-settled={region.settled}>{region.settled ? "true → empty may render" : "false → empty not entitled"}</span>} tone={region.settled ? "text-success-soft" : "text-slate-500"} />
        <Readout label="state" value={<StateChip state={state} />} />
        <Readout label="cause" value={<span data-cause={cause ?? "none"}>{cause ?? "—"}</span>} />
      </div>
      <p className="mt-2 type-caption text-slate-500">Register follows cause: instructional future tense for first-run, diagnostic present for no-match, a named missing thing for a prerequisite, a check for a drained queue.</p>
    </Region>
  );
}
