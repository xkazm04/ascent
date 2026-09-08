"use client";

// The desk's diff itself, rendered in the reader's mode. Side-by-side keeps both sides whole and
// collapses unchanged stretches behind a labelled expander; inline is one reading flow; summary is
// counts with their predicate. One result feeds all three, so the count and the detail agree by
// construction; the cut marker sits at the cut, in the flow, quantified when the remainder is known.

import { useState } from "react";
import { motion } from "framer-motion";
import { CHANGE_KINDS, type DiffResult, type DiffRow } from "./kernel";
import { BTN, KindMark, NOTICE, TD, TH } from "./parts";

export type Mode = "side-by-side" | "inline" | "summary";

function CutMarker({ result, shown }: { result: DiffResult; shown: number }) {
  const remainder = result.differences - shown;
  if (result.rung === "too-large") return <p className={NOTICE.cut} data-cut="uncounted">… further differences not computed — the line budget stopped the alignment before counting</p>;
  if (result.rung === "summary") return <p className={NOTICE.cut} data-cut="summary">… row detail not computed at this budget; the counts above are the ceiling the budget allowed</p>;
  if (remainder <= 0) return null;
  return (
    <p className={NOTICE.cut} data-cut="counted">
      … and {remainder.toLocaleString("en-US")} more {remainder === 1 ? "difference" : "differences"} — cut here, not at the end
    </p>
  );
}

function Cell({ v, side }: { v: string | null; side: "baseline" | "candidate" }) {
  // An absent side occupies real space: "this used to exist" ranks with "this is new".
  return <td className={`${TD} font-mono type-caption ${v === null ? "text-slate-700" : "text-slate-300"}`} data-side={side}>{v ?? "∅"}</td>;
}

export function DiffView({ result, mode, cap, reduced, onOpenDetail }: { result: DiffResult; mode: Mode; cap: number; reduced: boolean; onOpenDetail: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const differences = result.rows.filter((r) => r.kind !== "unchanged");
  const unchanged = result.rows.length - differences.length;
  const visible: DiffRow[] = (expanded ? result.rows : differences).slice(0, cap);
  const shownDiffs = visible.filter((r) => r.kind !== "unchanged").length;
  const enter = reduced ? undefined : { opacity: [0, 1] as number[] };
  const partial = shownDiffs < result.differences || !result.remainderKnown;

  if (mode === "summary") {
    return (
      <div data-mode="summary" className="space-y-2">
        <p className="type-mono-sm tabular-nums text-slate-200" data-summary-count={result.remainderKnown ? result.differences : "unknown"}>
          {result.remainderKnown ? `${result.differences.toLocaleString("en-US")}${partial ? "+" : ""}` : "?"} differences
          <span className="type-caption text-slate-500"> · {result.predicate}</span>
        </p>
        <ul className="flex flex-wrap gap-x-4 gap-y-1">
          {(Object.keys(CHANGE_KINDS) as (keyof typeof CHANGE_KINDS)[]).map((k) => (
            <li key={k} className="flex items-center gap-1.5">
              <KindMark kind={k} />
              <span className="type-mono-sm tabular-nums text-slate-400">{result.counts[k].toLocaleString("en-US")}</span>
            </li>
          ))}
        </ul>
        <button type="button" className={BTN} onClick={onOpenDetail}>open detail — same pair, same level, same predicate</button>
      </div>
    );
  }

  if (mode === "inline") {
    return (
      <div data-mode="inline" className="space-y-1">
        <ol className="font-mono type-caption">
          {visible.map((r) => (
            <motion.li key={r.key} initial={false} animate={enter} className="flex gap-2 border-t border-divider py-1" data-row={r.key} data-kind={r.kind}>
              <KindMark kind={r.kind} />
              <span className="text-slate-500">{r.name}</span>
              {r.kind === "changed" || r.kind === "moved" ? (
                <span><span className="text-tone-falling line-through">{r.before}</span> <span className="text-tone-rising">{r.after}</span></span>
              ) : (
                <span className="text-slate-300">{r.after ?? r.before}</span>
              )}
              {r.reason ? <span className="text-slate-500">({r.reason})</span> : null}
            </motion.li>
          ))}
        </ol>
        <CutMarker result={result} shown={shownDiffs} />
      </div>
    );
  }

  return (
    <div data-mode="side-by-side" className="space-y-1">
      <div className="overflow-x-auto">
        <table className="w-full type-caption">
          <thead className="type-label tracking-[0.2em] text-slate-500">
            <tr>
              <th className={TH}>mark</th>
              <th className={TH}>field</th>
              <th className={TH}>baseline</th>
              <th className={TH}>candidate</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <motion.tr key={r.key} initial={false} animate={enter} data-row={r.key} data-kind={r.kind}>
                <td className={TD}><KindMark kind={r.kind} />{r.inferred ? <span className="block type-micro text-slate-500">{r.inferred}</span> : null}</td>
                <td className={`${TD} text-slate-400`}>{r.name}{r.reason ? <span className="block type-micro text-slate-500">{r.reason}</span> : null}</td>
                <Cell v={r.before} side="baseline" />
                <Cell v={r.after} side="candidate" />
              </motion.tr>
            ))}
          </tbody>
        </table>
      </div>
      {unchanged > 0 ? (
        <button type="button" className={BTN} aria-expanded={expanded} onClick={() => setExpanded((e) => !e)} data-unchanged={unchanged}>
          {expanded ? "collapse" : "expand"} {unchanged} unchanged in this window — collapsed, not hidden
        </button>
      ) : null}
      <CutMarker result={result} shown={shownDiffs} />
    </div>
  );
}
