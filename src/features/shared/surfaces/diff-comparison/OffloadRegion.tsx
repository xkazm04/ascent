"use client";

// computation-offload: the request has an identity, the budget picks the rung, stale answers are dropped,
// the kernel's death is spelled as failure, the cache is bounded. The progress bar is the one moving
// element and it is content-free, so under `reduced` it is a static label instead.

import { motion } from "framer-motion";
import { BUDGET, type Rung } from "./kernel";
import { CACHE_CAP, type useComparison } from "./useComparison";
import { BTN, Readout, Region } from "./parts";

const RUNG_WORDS: Record<Rung, string> = {
  full: "1 · full diff at the chosen level",
  capped: "1 · full alignment, output capped — the cut is disclosed with its remainder",
  summary: "3 · summary counts only — labelled as the ceiling the budget allowed",
  "too-large": "4 · too large to compare at this level — itself an honest answer",
};

export function OffloadRegion({ cmp, killed, onKill, reduced }: { cmp: ReturnType<typeof useComparison>; killed: boolean; onKill: (k: boolean) => void; reduced: boolean }) {
  const { state } = cmp;
  const rung = state.status === "ready" ? state.result.rung : null;
  const status = state.status === "computing" ? "computing" : state.status;
  return (
    <Region technique="computation-offload" title="Computation offload" note="A diff that freezes the surface it explains has failed. Small pairs take the synchronous fast path; larger ones are scheduled with an identity and reaped on change.">
      <div className="space-y-3">
        <div className="grid gap-1 sm:grid-cols-2">
          <Readout label="request" value={`#${cmp.seq}`} />
          <Readout label="status" value={status} tone={status === "failed" ? "text-danger-soft" : status === "computing" ? "text-warn" : "text-slate-200"} />
          <Readout label="path" value={cmp.delay === 0 ? `sync fast path (≤ ${BUDGET.fastPathRows} rows)` : `scheduled · ${cmp.delay} ms`} />
          <Readout label="rows" value={cmp.n.toLocaleString("en-US")} />
          <Readout label="rung" value={rung ? RUNG_WORDS[rung] : "—"} tone={rung && rung !== "full" ? "text-warn" : "text-slate-200"} />
          <Readout label="stale responses dropped" value={cmp.dropped} tone={cmp.dropped > 0 ? "text-warn" : "text-slate-200"} />
          <Readout label="cache" value={`${cmp.cacheSize} / ${CACHE_CAP} · ${cmp.hits} hit${cmp.hits === 1 ? "" : "s"}`} />
          <Readout label="served from cache" value={state.status === "ready" && state.fromCache ? "yes — key names pair, level, ledger version, both fingerprints" : "no"} />
        </div>
        <div className="h-1 overflow-hidden rounded bg-surface" aria-hidden data-progress={status}>
          {status === "computing" ? (
            reduced ? <div className="h-full w-1/3 bg-accent" /> : <motion.div className="h-full w-1/3 bg-accent" initial={{ x: "-100%" }} animate={{ x: "300%" }} transition={{ duration: 0.9, repeat: Infinity, ease: "linear" }} />
          ) : (
            <div className={`h-full ${status === "failed" ? "bg-danger" : "bg-success"}`} style={{ width: status === "idle" ? "0%" : "100%" }} />
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className={BTN} onClick={cmp.race} aria-label="Race a stale response">race a stale response</button>
          <button type="button" className={BTN} aria-pressed={killed} onClick={() => onKill(!killed)}>{killed ? "revive the kernel" : "kill the kernel"}</button>
          <button type="button" className={BTN} onClick={cmp.retry} disabled={state.status !== "failed"}>retry</button>
        </div>
        <ul className="grid gap-x-4 gap-y-0.5 type-caption text-slate-500 sm:grid-cols-2">
          <li>fast path ≤ <span className="font-mono text-slate-300">{BUDGET.fastPathRows}</span> rows</li>
          <li>full rows ≤ <span className="font-mono text-slate-300">{BUDGET.fullRows.toLocaleString("en-US")}</span></li>
          <li>capped rows ≤ <span className="font-mono text-slate-300">{BUDGET.detailRows.toLocaleString("en-US")}</span>, then summary</li>
          <li>line level ≤ <span className="font-mono text-slate-300">{BUDGET.lineCap.toLocaleString("en-US")}</span> lines, then too large</li>
        </ul>
      </div>
    </Region>
  );
}
