"use client";

import type { Dispatch, SetStateAction } from "react";
import type { DimOption, RepoOption } from "@/components/org/plan/Simulator.types";

/** Clamp a typed target into 0..100 (investment 07-16 #3): the inputs' HTML min/max only constrain
 *  the spinner arrows — typing "150" / "-5" went straight into state, then either 400'd on simulate
 *  or was silently swapped for 70 by the rank route while the button advertised the typed value.
 *  Empty/garbage input keeps the previous value instead of `Number("") = 0` silently jumping to 0.
 *  ONE sanitizer for all target inputs (primary + extras), so the bounds can't drift. */
function clampTarget(raw: string, prev: number): number {
  if (raw.trim() === "") return prev;
  const n = Number(raw);
  if (!Number.isFinite(n)) return prev;
  return Math.min(100, Math.max(0, Math.round(n)));
}

/** The scenario inputs: primary leg, SIM-2 extra legs, and the repo scope picker. */
export function ScenarioForm({
  dims,
  repos,
  dimId,
  target,
  extras,
  used,
  scope,
  showRepos,
  scopeLabel,
  busy,
  invalidate,
  setDimId,
  setTarget,
  setScope,
  setShowRepos,
  toggle,
  updateExtra,
  removeExtra,
  addDimension,
  run,
}: {
  dims: DimOption[];
  repos: RepoOption[];
  dimId: string;
  target: number;
  extras: { key: number; dimId: string; target: number }[];
  used: Set<string>;
  scope: Set<string>;
  showRepos: boolean;
  scopeLabel: string;
  busy: boolean;
  invalidate: () => void;
  setDimId: (id: string) => void;
  setTarget: (n: number) => void;
  setScope: Dispatch<SetStateAction<Set<string>>>;
  setShowRepos: Dispatch<SetStateAction<boolean>>;
  toggle: (fullName: string) => void;
  updateExtra: (idx: number, patch: Partial<{ dimId: string; target: number }>) => void;
  removeExtra: (idx: number) => void;
  addDimension: () => void;
  run: () => void;
}) {
  return (
    <>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm text-slate-500">Raise</span>
        <select aria-label="Dimension to raise" value={dimId} onChange={(e) => { invalidate(); setDimId(e.target.value); }} className="rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 font-mono text-sm text-slate-200">
          {dims.map((d) => (
            <option key={d.id} value={d.id}>
              {d.id} · {d.label} (avg {d.avg})
            </option>
          ))}
        </select>
        <span className="font-mono text-sm text-slate-500">to</span>
        <input aria-label="Target score" type="number" min={0} max={100} value={target} onChange={(e) => { invalidate(); setTarget(clampTarget(e.target.value, target)); }} className="w-16 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm text-slate-200" />
        <span className="font-mono text-sm text-slate-500">across</span>
        <button
          onClick={() => setShowRepos((s) => !s)}
          aria-expanded={showRepos}
          aria-controls="sim-scope-repos"
          className="rounded-lg border border-slate-700 px-2.5 py-1.5 font-mono text-sm text-slate-300 hover:border-accent hover:text-white"
        >
          {scopeLabel} ▾
        </button>
        <button onClick={run} disabled={busy} className="rounded-lg border border-accent/50 bg-accent/10 px-3 py-1.5 text-sm font-medium text-white hover:bg-accent/20 disabled:opacity-50">
          {busy ? "Simulating…" : "Simulate"}
        </button>
      </div>

      {/* SIM-2: additional dimensions raised in the same scenario — model a combined push. */}
      {extras.map((e, idx) => (
        <div key={e.key} className="mt-2 flex flex-wrap items-center gap-2">
          <span className="font-mono text-sm text-slate-500">and</span>
          <select
            aria-label={`Additional dimension ${idx + 2} to raise`}
            value={e.dimId}
            onChange={(ev) => updateExtra(idx, { dimId: ev.target.value })}
            className="rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 font-mono text-sm text-slate-200"
          >
            {dims
              .filter((d) => d.id === e.dimId || !used.has(d.id))
              .map((d) => (
                <option key={d.id} value={d.id}>
                  {d.id} · {d.label} (avg {d.avg})
                </option>
              ))}
          </select>
          <span className="font-mono text-sm text-slate-500">to</span>
          <input
            aria-label={`Target score for dimension ${idx + 2}`}
            type="number"
            min={0}
            max={100}
            value={e.target}
            onChange={(ev) => updateExtra(idx, { target: clampTarget(ev.target.value, e.target) })}
            className="w-16 rounded-lg border border-slate-700 bg-slate-900 px-2 py-1.5 text-sm text-slate-200"
          />
          <button onClick={() => removeExtra(idx)} className="font-mono text-sm text-slate-600 hover:text-orange-300" title="Remove this dimension">
            remove
          </button>
        </div>
      ))}
      {dims.length > used.size && (
        <button onClick={addDimension} className="mt-2 font-mono text-sm text-accent hover:text-white">
          + add a dimension
        </button>
      )}

      {showRepos && (
        <div id="sim-scope-repos" className="mt-3 max-h-40 overflow-auto rounded-lg border border-slate-800 bg-slate-950/40 p-3">
          <div className="mb-2 flex gap-3 font-mono text-sm text-slate-500">
            <button onClick={() => { invalidate(); setScope(new Set()); }} className="hover:text-white">all</button>
            <button onClick={() => { invalidate(); setScope(new Set(repos.map((r) => r.fullName))); }} className="hover:text-white">select all</button>
          </div>
          <div className="grid gap-1 sm:grid-cols-2">
            {repos.map((r) => (
              <label key={r.fullName} className="flex items-center gap-2 font-mono text-sm text-slate-300">
                <input type="checkbox" checked={scope.has(r.fullName)} onChange={() => toggle(r.fullName)} className="accent-accent" />
                {r.name}
              </label>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
