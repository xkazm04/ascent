"use client";

// full-text-indexing: the trade, made visible. Index or scan (the same query, timed); the tokenizer
// decisions that cannot be unmade at query time (folding, hump splitting) shown on two pinned names;
// the maintenance posture — synchronous with the write, or an index that only grows — with deletions
// producing ghost hits under the second; a drift check that reads the index's OWN storage against the
// source, `!=` not `<`; and the documented, invokable rebuild.

import { tokenize } from "./tokenize";
import type { FleetSearch } from "./useFleetSearch";
import { BTN, Readout, Region, toggleClass } from "./sceneParts";

const SAMPLE = ["authService", "résumé-parser"];

export function IndexPanel({ s }: { s: FleetSearch }) {
  const o = s.indexOpts;
  const indexed = s.engine.docs.size; // the index's own storage (docIds), never a count answered from the source
  const drift = indexed !== s.source.length;
  const topId = s.pageRows[0]?.repo.id;
  return (
    <Region technique="full-text-indexing" title="A derived artifact, kept honest" note="An index is a lossy summary of the source. What the tokenizer throws away can never be matched; what the reaper misses is a ghost.">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={toggleClass(o.mode === "index")} onClick={() => s.setIndexOpts({ ...o, mode: "index" })} aria-pressed={o.mode === "index"}>
          inverted index
        </button>
        <button type="button" className={toggleClass(o.mode === "scan")} onClick={() => s.setIndexOpts({ ...o, mode: "scan" })} aria-pressed={o.mode === "scan"}>
          linear scan
        </button>
        <span className="type-caption text-slate-500" data-engine-mode={o.mode}>
          last query {s.ms.toFixed(1)}ms over {s.source.length.toLocaleString()} rows
        </span>
      </div>
      <p className="mt-1 type-caption text-slate-500">Below a few thousand short rows the scan is the correct engineering; the knob at 50k shows where the cliff is.</p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" className={toggleClass(o.tok.fold)} onClick={() => s.setTok({ fold: !o.tok.fold })} aria-pressed={o.tok.fold}>
          fold case + diacritics
        </button>
        <button type="button" className={toggleClass(o.tok.splitHumps)} onClick={() => s.setTok({ splitHumps: !o.tok.splitHumps })} aria-pressed={o.tok.splitHumps}>
          split identifier humps
        </button>
      </div>
      <ul className="mt-2 space-y-0.5" data-tokenizer-demo>
        {SAMPLE.map((name) => (
          <li key={name} className="flex items-baseline justify-between gap-2 type-caption">
            <span className="font-mono text-slate-300">{name}</span>
            <span className="font-mono text-slate-500" data-tokens={name}>
              {tokenize(name, o.tok).join(" · ")}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-1 type-caption text-slate-500">Both sides pass through the same fold, so a query for “resume” finds “résumé” exactly when the index folded it. Changing either setting rebuilds the index — the decision is baked into the stored tokens.</p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" className={toggleClass(o.posture === "sync")} onClick={() => s.setIndexOpts({ ...o, posture: "sync" })} aria-pressed={o.posture === "sync"}>
          sync with the write
        </button>
        <button type="button" className={toggleClass(o.posture === "grow")} onClick={() => s.setIndexOpts({ ...o, posture: "grow" })} aria-pressed={o.posture === "grow"}>
          index only grows
        </button>
        <button type="button" className={BTN} disabled={!topId} onClick={() => topId && s.deleteRow(topId)}>
          delete top result
        </button>
        <button type="button" className={BTN} disabled={s.deleted.size === 0} onClick={s.restoreRows}>
          restore rows
        </button>
      </div>
      <div className="mt-2 space-y-1">
        <Readout label="source rows" value={s.source.length.toLocaleString()} />
        <Readout label="index docs (its own storage)" value={<span data-indexed={indexed}>{indexed.toLocaleString()}</span>} />
        <Readout label="drift check (index != source)" value={<span data-drift={drift}>{drift ? `drift: ${Math.abs(indexed - s.source.length)} — rebuild` : "no drift"}</span>} tone={drift ? "text-danger" : "text-success-soft"} />
        <Readout label="ghost hits in this query" value={<span data-ghosts={s.ghosts.length}>{s.ghosts.length}</span>} tone={s.ghosts.length ? "text-warn" : "text-slate-200"} />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button type="button" className={BTN} disabled={!drift} onClick={s.rebuild}>
          rebuild from source
        </button>
        <span className="type-caption text-slate-500">the named recomputation — invoked on disagreement, not on a schedule</span>
      </div>
    </Region>
  );
}
