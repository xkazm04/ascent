"use client";

// preset-vocabulary: the three named presets, each declared once with intent, per-track duration
// class + easing role, and its own reduced fallback — replayed on a sample chip by remounting it.
// taste-budgets: a slider that pushes an entrance choreography past the cap and turns the meter red;
// the cap and the stagger step are the constants in presets.ts, not numbers remembered here.

import { useState } from "react";
import { BUDGET, DURATION_MS, PRESETS, animationFor, entranceTotalMs, presetMs, type PresetName } from "./presets";
import { BTN, Readout, Region } from "./sceneParts";

const SHOWN: PresetName[] = ["entrance", "success-settle", "ambient-breathe"];

export function PresetRegion({ reduced }: { reduced: boolean }) {
  const [plays, setPlays] = useState<Record<string, number>>({});
  return (
    <Region technique="preset-vocabulary" title="A named vocabulary" note="Intent + fallback per gesture; duration class + easing role per track. No preset inlines a millisecond.">
      <ul className="space-y-2">
        {SHOWN.map((name) => {
          const p = PRESETS[name];
          const loop = p.cls === "ambient";
          return (
            <li key={name} className="grid grid-cols-[auto_1fr_auto] items-center gap-3 rounded-lg border border-divider p-2">
              <span
                key={plays[name] ?? 0}
                className="inline-block h-6 w-6 rounded-md bg-accent"
                style={{ animation: animationFor(name, reduced, { loop }) }}
                aria-hidden
              />
              <div className="min-w-0">
                <p className="type-caption text-slate-200">
                  {name} <span className="text-slate-500">· {p.cls}</span>
                </p>
                <p className="truncate type-caption text-slate-500">{p.intent}</p>
                <p className="truncate type-caption text-slate-600">
                  {p.tracks.map((t) => (t.kind === "timed" ? `${t.property}: ${t.duration}/${t.easing}` : `${t.property}: spring`)).join(" · ")} → reduced:{" "}
                  {p.reduced}
                </p>
              </div>
              {loop ? (
                <span className="type-caption text-slate-600">loop</span>
              ) : (
                <button type="button" className={BTN} onClick={() => setPlays((s) => ({ ...s, [name]: (s[name] ?? 0) + 1 }))}>
                  play
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </Region>
  );
}

export function BudgetRegion() {
  const [perItem, setPerItem] = useState<number>(presetMs("entrance"));
  const [count, setCount] = useState(6);
  const total = entranceTotalMs(perItem, count);
  const over = total > BUDGET.entranceCapMs;
  const pct = Math.min(100, Math.round((total / BUDGET.entranceCapMs) * 100));
  return (
    <Region technique="taste-budgets" title="Budgets with owners" note="Entrance total = per-item motion + accumulated stagger, count-capped. Push it past the cap.">
      <div className="space-y-3">
        <label className="block">
          <span className="type-caption text-slate-400">per-item entrance: {perItem}ms</span>
          <input
            type="range"
            min={DURATION_MS.fast}
            max={1400}
            step={20}
            value={perItem}
            onChange={(e) => setPerItem(Number(e.target.value))}
            className="mt-1 w-full accent-[var(--color-accent)]"
            aria-label="Per-item entrance duration"
          />
        </label>
        <label className="block">
          <span className="type-caption text-slate-400">
            items: {count} (stagger counts the first {BUDGET.staggerCountCap})
          </span>
          <input type="range" min={1} max={24} value={count} onChange={(e) => setCount(Number(e.target.value))} className="mt-1 w-full accent-[var(--color-accent)]" aria-label="Item count" />
        </label>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-divider" role="meter" aria-valuenow={total} aria-valuemax={BUDGET.entranceCapMs} aria-label="Entrance budget">
          <div className={`h-full ${over ? "bg-danger" : "bg-accent"}`} style={{ width: `${pct}%` }} />
        </div>
        <Readout label="total" value={`${total}ms / ${BUDGET.entranceCapMs}ms cap`} tone={over ? "text-danger" : "text-slate-200"} />
        <Readout label="ambient bound" value={`≤ ${BUDGET.ambientTravelPx}px over ${BUDGET.ambientPeriodMs}ms`} />
        <p className="type-caption text-slate-500" data-budget-state={over ? "over" : "within"}>
          {over ? "Over budget: this is a proposal to change the cap, not a new preset." : "Within budget — the cap is enforced where the presets live."}
        </p>
      </div>
    </Region>
  );
}
