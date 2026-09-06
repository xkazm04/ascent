"use client";

// performance: the ladder, climbed under measurement. Rung 0 is the instrument itself — rows in the
// store, rows mounted, rows rendered by the LAST interaction (a DOM counter the memoized rows write in
// their commit effect, never state), and how many times the presentation sequence was derived. Rung 1
// is the page size; rung 2 the view model precomputed per delivery; rung 3 the memoized row keyed by
// identity that reads its own `selected` boolean; rung 4 is refused on purpose, with its costs named.
// The rung is chosen at runtime from the count the surface was handed — one decision site.

import { useEffect, useRef } from "react";
import { PAGE_SIZE } from "./fixtures";
import { rungFor } from "./ledger";
import { Readout, Region } from "./sceneParts";
import type { Ledger } from "./useLedger";

const RUNGS = [
  ["1", "page the fetch", `PAGE_SIZE = ${PAGE_SIZE}: query, payload, mount and layout are all capped here`],
  ["2", "cheap rows", "toVM() runs once per delivered rows; cells place strings; fixed row height"],
  ["3", "memoized rows", "LedgerRow is memo(); it receives its own `selected`, not the set; keyed by id"],
  ["4", "windowed rendering", "refused: find-in-page and AT traversal would pay for mounting fewer than 25"],
] as const;

export function PerfRegion({ l, volume }: { l: Ledger; volume: number }) {
  const { rung, why } = rungFor(volume);
  const { logEl: setLogEl } = l; // the render-log node registers itself with the hook
  // Derivations: `view` is a memo over named inputs; this effect runs exactly when it recomputes.
  const derivations = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = derivations.current;
    if (el) el.textContent = String(Number(el.textContent || "0") + 1);
  }, [l.view]);

  return (
    <Region technique="performance" title="Climb only as far as measured" note="Rung 0 first: what is mounted, what repaints, what recomputes. Toggle one checkbox in the ledger and read the counter.">
      <div className="space-y-1">
        <Readout label="rows in store" value={l.storeSize.toLocaleString()} />
        <Readout label="rows mounted" value={<span data-mounted={l.rows.length}>{l.rows.length}</span>} />
        <Readout label="rows rendered by last interaction" value={<span ref={(el) => setLogEl(el)} data-render-log>0</span>} />
        <Readout label="sequence derivations" value={<span ref={derivations}>0</span>} />
        <Readout label="rung chosen at runtime" value={<span data-rung={rung}>{rung}</span>} />
      </div>
      <p className="mt-2 type-caption text-slate-500">{why}</p>
      <ol className="mt-3 space-y-1">
        {RUNGS.map(([n, name, note]) => {
          const active = Number(n) <= rung;
          return (
            <li key={n} className="flex items-baseline gap-2 type-caption" data-rung-row={n} data-active={active}>
              <span className={`w-4 shrink-0 font-mono tabular-nums ${active ? "text-accent" : "text-slate-600"}`}>{n}</span>
              <span className={active ? "text-slate-200" : "text-slate-500 line-through decoration-slate-700"}>{name}</span>
              <span className="text-slate-500">— {note}</span>
            </li>
          );
        })}
      </ol>
    </Region>
  );
}
