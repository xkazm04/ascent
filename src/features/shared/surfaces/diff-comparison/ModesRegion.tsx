"use client";

// presentation-modes: the diff in the reader's mode. The mode is a remembered reader preference (per
// reader, across pairs), with a transient per-pair override; the change-kind legend is the one
// vocabulary; below an effective width the two-pane layout hard-switches to inline rather than
// wrapping into a layout whose "opposite is counterpart" claim has stopped being true.

import { useEffect, useRef, useState } from "react";
import type { ComparisonState } from "./useComparison";
import { CHANGE_KINDS, KIND_ORDER } from "./kernel";
import { DiffView, type Mode } from "./DiffView";
import { Chip, KindMark, NOTICE, Readout, Region } from "./parts";

export const NARROW_PX = 560;

function useEffectiveWidth(ref: React.RefObject<HTMLDivElement | null>): number | null {
  const [width, setWidth] = useState<number | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return; // jsdom: abstain, never guess narrow
    const ro = new ResizeObserver((entries) => setWidth(Math.round(entries[0]?.contentRect.width ?? 0)));
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return width;
}

export function ModesRegion({
  state,
  remembered,
  onRemember,
  override,
  onOverride,
  cap,
  reduced,
  pairNotice,
}: {
  state: ComparisonState;
  remembered: Mode;
  onRemember: (m: Mode) => void;
  override: Mode | null;
  onOverride: (m: Mode | null) => void;
  cap: number;
  reduced: boolean;
  /** A degenerate pair (self-comparison, a declared baseline) replaces the diff with its label. */
  pairNotice: string | null;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const width = useEffectiveWidth(ref);
  const chosen = override ?? remembered;
  const narrow = width !== null && width < NARROW_PX;
  const mode: Mode = chosen === "side-by-side" && narrow ? "inline" : chosen;

  return (
    <Region technique="presentation-modes" title="Presentation modes" note="One difference, three honest renderings — chosen by the reader, remembered for the reader; never inferred from the task.">
      <div ref={ref} className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          {(["side-by-side", "inline", "summary"] as Mode[]).map((m) => (
            <Chip key={m} on={chosen === m} onClick={() => onOverride(m === remembered ? null : m)} label={`Show ${m}`}>
              {m}
            </Chip>
          ))}
          <button type="button" className="focus-ring type-caption text-slate-500 underline-offset-2 hover:text-white hover:underline" onClick={() => { onRemember(chosen); onOverride(null); }}>
            remember {chosen} for me
          </button>
        </div>
        <div className="grid gap-1 sm:grid-cols-2">
          <Readout label="remembered" value={remembered} />
          <Readout label="this pair" value={override ? `${override} (transient override)` : "remembered preference"} />
          <Readout label="effective width" value={width === null ? "not observed" : `${width}px${narrow ? " → inline (hard switch)" : ""}`} tone={narrow ? "text-warn" : "text-slate-200"} />
          <Readout label="direction" value="candidate read against baseline; + is candidate surplus" />
        </div>
        <ul className="flex flex-wrap gap-x-3 gap-y-1" aria-label="Change-kind vocabulary">
          {KIND_ORDER.map((k) => (
            <li key={k} className="flex items-center gap-1"><KindMark kind={k} /><span className="type-micro text-slate-600">{CHANGE_KINDS[k].glyph}</span></li>
          ))}
        </ul>
        {pairNotice ? (
          <p className={NOTICE.info} data-diff-state="degenerate">{pairNotice}</p>
        ) : state.status === "failed" ? (
          <p className={NOTICE.failure} role="alert" data-diff-state="failed">Comparison unavailable — {state.message}. This is not an empty diff.</p>
        ) : state.status === "ready" ? (
          state.result.differences === 0 && state.result.remainderKnown ? (
            <p className={NOTICE.info} data-diff-state="zero">No differences at {state.result.predicate} — compared, none found.</p>
          ) : (
            <div data-diff-state="ready">
              <DiffView result={state.result} mode={mode} cap={cap} reduced={reduced} onOpenDetail={() => onOverride("side-by-side")} />
            </div>
          )
        ) : (
          <p className={NOTICE.info} data-diff-state="computing">Comparing… (request in flight; nothing here is a finding yet)</p>
        )}
      </div>
    </Region>
  );
}
