"use client";

// gesture-decomposition: "a card becomes selected" is three communicative jobs on three independent
// tracks — border colour (fast, flat), lift (base, weight), disclosure (deliberate, unhurried) —
// each with its own duration class and easing role, none aware of the others. The input axis is
// EVENT-driven (a click selects the target; the transition between targets is timed). The track
// table is the preset proposal the vocabulary can accept or reject; the card plays it. Reduced:
// the border and disclosure settle instantly, the lift (travel) is removed.

import { useState } from "react";
import { DURATION_MS, EASING, type DurationClass, type EasingRole } from "./presets";
import { BTN, Region } from "./sceneParts";

type TrackRow = { property: string; job: string; duration: DurationClass; easing: EasingRole };

const TRACKS: readonly TrackRow[] = [
  { property: "border-color", job: "claims selection", duration: "fast", easing: "move" },
  { property: "transform: scale", job: "lifts to claim emphasis", duration: "base", easing: "enter" },
  { property: "opacity + translateY (detail)", job: "opens the detail, unhurried", duration: "deliberate", easing: "enter" },
];

const t = (row: TrackRow, reduced: boolean) => (reduced ? "none" : `${DURATION_MS[row.duration]}ms ${EASING[row.easing]}`);

export function GestureRegion({ reduced }: { reduced: boolean }) {
  const [selected, setSelected] = useState(false);
  const [border, lift, detail] = TRACKS;
  return (
    <Region technique="gesture-decomposition" title="Cut it into tracks first" note="Input axis: event-driven. Three properties, three curves, retunable one at a time.">
      <div className="grid gap-3 sm:grid-cols-[1fr_1.2fr]">
        <div>
          <button
            type="button"
            aria-pressed={selected}
            onClick={() => setSelected((s) => !s)}
            className={`focus-ring w-full rounded-lg border bg-surface/40 p-3 text-left ${selected ? "border-accent" : "border-divider"}`}
            style={{
              transform: selected && !reduced ? "scale(1.03)" : "scale(1)",
              transition: [`border-color ${t(border, reduced)}`, `transform ${t(lift, reduced)}`].join(", "),
            }}
            data-selected={selected}
          >
            <p className="type-body-sm text-white">repository card</p>
            <p className="type-caption text-slate-500">click to select</p>
            <div
              className="overflow-hidden"
              style={{
                opacity: selected ? 1 : 0,
                transform: selected || reduced ? "translateY(0)" : "translateY(-6px)",
                maxHeight: selected ? "4rem" : "0",
                transition: [`opacity ${t(detail, reduced)}`, `transform ${t(detail, reduced)}`, `max-height ${t(detail, reduced)}`].join(", "),
              }}
              aria-hidden={!selected}
            >
              <p className="mt-2 type-caption text-slate-400">L3 · 14 open follow-ups · last scan 2h ago</p>
            </div>
          </button>
          <button type="button" className={`${BTN} mt-2`} onClick={() => setSelected(false)}>
            reset
          </button>
        </div>
        <table className="w-full self-start type-caption">
          <thead>
            <tr className="text-left text-slate-500">
              <th className="font-normal">track</th>
              <th className="font-normal">duration</th>
              <th className="font-normal">easing</th>
            </tr>
          </thead>
          <tbody>
            {TRACKS.map((row) => (
              <tr key={row.property} className="border-t border-divider align-top text-slate-300">
                <td className="py-1">
                  {row.property}
                  <span className="block text-slate-600">{row.job}</span>
                </td>
                <td className="py-1">{row.duration}</td>
                <td className="py-1">{row.easing}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Region>
  );
}
