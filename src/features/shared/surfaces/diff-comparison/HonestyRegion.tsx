"use client";

// diff-honesty: every mechanism that can produce false silence discloses itself where the silence
// would form. The cut control moves the truncation point and the marker follows it, quantified only
// when the remainder was counted; the undiffable is a third state with its reason; failure is failure
// with a retry beside it; a move is an inference and says so; the summary carries the detail's predicate.

import { useState } from "react";
import type { Signal } from "./fixtures";
import type { ComparisonState } from "./useComparison";
import { BTN, Chip, KindMark, NOTICE, Readout, Region } from "./parts";

export const CAPS = [4, 8, 24] as const;

export function HonestyRegion({ state, cap, onCap, retry, base, cand }: { state: ComparisonState; cap: number; onCap: (c: number) => void; retry: () => void; base: readonly Signal[]; cand: readonly Signal[] }) {
  const [raw, setRaw] = useState(false);
  const result = state.status === "ready" ? state.result : null;
  const notCompared = result?.rows.filter((r) => r.kind === "not-compared") ?? [];
  const moved = result?.rows.find((r) => r.kind === "moved") ?? null;
  const shown = result ? Math.min(cap, result.rows.filter((r) => r.kind !== "unchanged").length) : 0;
  const partial = result ? !result.remainderKnown || shown < result.differences : false;
  const headline = !result ? "—" : !result.remainderKnown ? "partial comparison — count unknown" : `${result.differences.toLocaleString("en-US")}${partial ? "+" : ""} ${result.level === "lines" ? "lines" : "fields"} changed (${result.predicate})`;

  return (
    <Region technique="diff-honesty" title="Diff honesty" note="The reader trusts silence. Truncation, exclusion, failure and inference each speak at the point where the wrong inference would otherwise form.">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Rows shown before the cut">
          <span className="type-caption text-slate-500">cut after</span>
          {CAPS.map((c) => (
            <Chip key={c} on={cap === c} onClick={() => onCap(c)} label={`Cut after ${c} rows`}>{c}</Chip>
          ))}
        </div>
        <div className="grid gap-1 sm:grid-cols-2">
          <Readout label="summary line" value={headline} tone={partial ? "text-warn" : "text-slate-200"} />
          <Readout label="shown / found" value={result ? `${shown} / ${result.remainderKnown ? result.differences.toLocaleString("en-US") : "?"}` : "—"} />
          <Readout label="remainder wording" value={!result ? "—" : !result.remainderKnown ? "further differences not computed" : result.rung === "summary" ? "row detail not computed at this budget" : result.differences - shown > 0 ? `and ${(result.differences - shown).toLocaleString("en-US")} more` : "none — nothing beyond the cut"} />
          <Readout label="not compared" value={result ? `${result.counts["not-compared"]} row${result.counts["not-compared"] === 1 ? "" : "s"} (third state, never "unchanged")` : "—"} />
        </div>
        {notCompared.length > 0 ? (
          <ul className="space-y-0.5" data-not-compared={notCompared.length}>
            {notCompared.map((r) => (
              <li key={r.key} className="flex flex-wrap items-center gap-2 type-caption"><KindMark kind="not-compared" /><span className="text-slate-300">{r.name}</span><span className="text-slate-500">— {r.reason}</span></li>
            ))}
          </ul>
        ) : null}
        {moved ? (
          <p className={NOTICE.info} data-moved-inferred="true">
            <KindMark kind="moved" /> <span className="text-slate-300">{moved.name}</span> — {moved.inferred}. A guess wears its confidence; the unprocessed pair stays one action away.
            <button type="button" className={`${BTN} ml-2`} aria-pressed={raw} onClick={() => setRaw((r) => !r)}>{raw ? "hide raw pair" : "show raw pair"}</button>
          </p>
        ) : null}
        {raw ? (
          <div className="grid gap-2 font-mono type-micro text-slate-400 sm:grid-cols-2" data-raw-pair="true">
            <ol className="rounded border border-divider p-2">{base.slice(0, 8).map((s) => <li key={s.id}>{s.id}: {s.value}</li>)}</ol>
            <ol className="rounded border border-divider p-2">{cand.slice(0, 8).map((s) => <li key={s.id}>{s.id}: {s.value}</li>)}</ol>
          </div>
        ) : null}
        {state.status === "failed" ? (
          <div className={NOTICE.failure} role="alert" data-honesty-failure="true">
            Comparison unavailable: {state.message}. Not an empty diff, not zero differences.
            <button type="button" className={`${BTN} ml-2`} onClick={retry}>re-run the comparison</button>
          </div>
        ) : (
          <p className="type-caption text-slate-500">failure state: <span className="text-slate-300">none</span> — the kill switch in the offload region shows what a dead kernel renders as.</p>
        )}
        <p className="type-caption text-slate-500">
          vocabulary matches alignment: under positional alignment a mismatched slot reads as <span className="text-slate-300">changed (positional)</span> in the predicate — a weaker claim than keyed &quot;changed&quot;, and the surface says which one it made.
        </p>
      </div>
    </Region>
  );
}
