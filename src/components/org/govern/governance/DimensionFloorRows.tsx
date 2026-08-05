"use client";

// Per-dimension gate floors for dimensions OTHER than D9 — the "no repo may score below N on Testing"
// bar. GatePolicy has always carried D1..D9 floors and the gate enforces every one of them, but the
// editor exposed only D9, so any other floor was reachable only by POSTing raw JSON at
// /api/org/gate-policy. This is the missing control, kept in its own file so GatePolicyEditor.tsx stays
// well inside the LOC cap (AGENTS.md).
//
// D9 deliberately keeps its own dedicated checkbox up in the parent form and is EXCLUDED here: it is
// the one fully deterministic dimension, the only floor the gate URL / CI action input expose
// (?min_security / min-security), and switching it on also forbids the "ungoverned" posture. Merging
// it into this generic list would quietly drop all three of those behaviors.

import { DIMENSIONS } from "@/lib/maturity/model";

/** Every dimension a generic floor can be set on — D9 is handled by the parent's Security control. */
const FLOOR_DIMENSIONS = DIMENSIONS.filter((d) => d.id !== "D9");

export function DimensionFloorRows({
  floors,
  onChange,
}: {
  /** Configured floors as raw input strings, keyed by dimension id (absent = no floor). */
  floors: Record<string, string>;
  /** `null` removes the floor entirely; a string sets/updates it. */
  onChange: (dimId: string, value: string | null) => void;
}) {
  const configured = FLOOR_DIMENSIONS.filter((d) => floors[d.id] != null);
  const available = FLOOR_DIMENSIONS.filter((d) => floors[d.id] == null);

  return (
    <div className="mt-3 border-t border-slate-800 pt-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-mono text-sm uppercase tracking-widest text-slate-500">Other dimension floors</span>
        <span className="text-sm text-slate-500">Enforced by the gate; not exposed as a CI input.</span>
      </div>

      {configured.length === 0 ? (
        <p className="mt-2 text-sm text-slate-500">
          No per-dimension floors beyond Security. Add one to hold every repo to a minimum on a specific
          dimension.
        </p>
      ) : (
        <ul className="mt-2 space-y-2">
          {configured.map((d) => (
            <li key={d.id} className="flex items-center gap-2">
              <label className="flex flex-1 items-center justify-between gap-2 text-sm text-slate-400">
                <span>
                  <span className="font-mono text-slate-500">{d.id}</span> {d.name} ≥
                </span>
                <input
                  type="number"
                  // Named explicitly: the visible label text is the dimension, but assistive tech needs
                  // to hear WHICH bar this number is (the same reason the D9 input carries an aria-label).
                  aria-label={`${d.id} ${d.name} minimum score`}
                  min={1}
                  max={100}
                  value={floors[d.id] ?? ""}
                  onChange={(e) => onChange(d.id, e.target.value)}
                  className="w-20 rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-200 outline-none focus:border-accent"
                />
              </label>
              <button
                type="button"
                onClick={() => onChange(d.id, null)}
                aria-label={`Remove the ${d.id} ${d.name} floor`}
                className="rounded-md border border-slate-700 px-2 py-1 font-mono text-sm text-slate-500 transition hover:border-orange-400 hover:text-orange-300"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}

      {available.length > 0 && (
        <label className="mt-2 flex items-center gap-2 text-sm text-slate-400">
          Add a floor
          <select
            // A controlled select pinned to "" — picking a dimension ADDS a row (seeded at 50, the same
            // starting bar the Security control uses) and immediately resets, so the control never shows
            // a stale selection that isn't part of the policy.
            value=""
            onChange={(e) => e.target.value && onChange(e.target.value, "50")}
            className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-sm text-slate-200 outline-none focus:border-accent"
          >
            <option value="">select a dimension…</option>
            {available.map((d) => (
              <option key={d.id} value={d.id}>
                {d.id} · {d.name}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}
