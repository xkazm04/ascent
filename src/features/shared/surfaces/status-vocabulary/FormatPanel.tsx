"use client";

// number-formatting: the viewer's language is switched HERE and every figure in the ledger follows,
// because `Num` binds the locale inside itself — no cell was told. The strip shows the unit as part
// of the value (symbol position, lakh grouping, compact as a numbering system) and the three facts
// (zero, absent, sub-unit) beside what `$${v.toFixed(2)}` would have said.
// timestamp-display: the shared self-scaling ticker's readouts and its VISIBLE pause control (it is
// a loop; under `reduced` it starts paused), the fixed-moment variants, and the skew ledger.

import { useEffect, useReducer, useState } from "react";
import { FUTURE_SKEW_TOLERANCE_MS, fmtNumber, handRolledMoney, onSkew, skewReports, type MomentVariant } from "./formatters";
import { Elapsed, Moment, Num } from "./primitives";
import { BTN, BTN_ON, Readout, Region } from "./sceneParts";
import { setPaused, subscribe, tickerState } from "./ticker";
import { LOCALES, type Locale } from "./vocabulary";

const FACTS: readonly { label: string; value: number | null }[] = [
  { label: "money", value: 1234.5 },
  { label: "exact zero", value: 0 },
  { label: "absent", value: null },
  { label: "sub-cent", value: 0.0042 },
  { label: "refund", value: -0.004 },
];

export function NumberRegion({ locale, onLocale }: { locale: Locale; onLocale: (l: Locale) => void }) {
  return (
    <Region technique="number-formatting" title="One renderer, locale bound inside" note="Switch the viewer's language: every figure in the ledger follows, and no cell passed a locale.">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Viewer language">
        {LOCALES.map((l) => (
          <button key={l} type="button" className={l === locale ? BTN_ON : BTN} onClick={() => onLocale(l)} aria-pressed={l === locale}>
            {l}
          </button>
        ))}
      </div>
      <table className="mt-3 w-full type-caption">
        <thead>
          <tr className="text-left text-slate-500">
            <th className="font-normal">fact</th>
            <th className="font-normal">primitive</th>
            <th className="font-normal">hand-rolled</th>
          </tr>
        </thead>
        <tbody>
          {FACTS.map((f) => (
            <tr key={f.label} className="border-t border-divider" data-fact={f.label}>
              <td className="py-1 text-slate-400">{f.label}</td>
              <td className="py-1">
                <Num value={f.value} unit="usd" />
              </td>
              <td className="py-1 type-mono-sm tabular-nums text-slate-500" data-hand-rolled>{handRolledMoney(f.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-2 space-y-1">
        <Readout label="compact" value={<Num value={2_345_678} unit="compact" />} />
        <Readout label="percent" value={<Num value={0.9375} unit="percent" />} />
        <Readout label="fixed-locale override" value={fmtNumber(1234.5, "usd", "de-DE")} />
      </div>
      <p className="mt-2 type-caption text-slate-500">The hand-rolled column concatenates a glyph to a fixed render: it cannot move the symbol, cannot regroup, and says $0.00 for a real sub-cent spend and for an absent figure alike.</p>
    </Region>
  );
}

const VARIANTS: readonly MomentVariant[] = ["compact", "time", "full"];

export function TimeRegion({ reduced, mountedAt, skewInstant }: { reduced: boolean; mountedAt: number; skewInstant: number }) {
  const [paused, setPausedState] = useState(reduced);
  const [variant, setVariant] = useState<MomentVariant>("compact");
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  useEffect(() => subscribe({ notify: rerender }), []);
  useEffect(() => {
    const off = onSkew(rerender);
    rerender(); // the cells' effects ran before this subscription: pick up a report that already fired
    return off;
  }, []);
  useEffect(() => {
    setPaused(paused); // the region is the ticker's pause authority
    return () => setPaused(false);
  }, [paused]);
  const t = tickerState();
  return (
    <Region technique="timestamp-display" title="Relative by default, absolute one hover away" note="Every elapsed cell subscribes to one ticker whose cadence follows the youngest label. The future is clamped, then abandoned.">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={BTN} onClick={() => setPausedState(true)} disabled={paused} aria-label="Pause the ticker">
          ■ pause ticker
        </button>
        <button type="button" className={BTN} onClick={() => setPausedState(false)} disabled={!paused} aria-label="Resume the ticker">
          ▶ resume
        </button>
        <span className="type-caption text-slate-500" data-ticker={paused ? "paused" : "running"}>
          {paused ? "paused: labels are held still and say so" : `running · ${t.subscribers} subscribers · one timer at ${t.cadenceMs / 1000}s`}
        </span>
      </div>
      <div className="mt-3 space-y-1">
        <Readout label="fresh (12s)" value={<Elapsed instant={mountedAt - 12_000} />} />
        <Readout label="yesterday" value={<Elapsed instant={mountedAt - 26 * 3_600_000} />} />
        <Readout label="+40s skew" value={<Elapsed instant={mountedAt + 40_000} />} />
        <Readout label="+3h skew" value={<Elapsed instant={skewInstant} />} />
        <Readout label="skew reports" value={<span data-skew-reports={skewReports()}>{skewReports()}</span>} tone={skewReports() ? "text-warn" : "text-slate-200"} />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {VARIANTS.map((v) => (
          <button key={v} type="button" className={v === variant ? BTN_ON : BTN} onClick={() => setVariant(v)} aria-pressed={v === variant}>
            {v}
          </button>
        ))}
        <Moment instant={mountedAt - 26 * 3_600_000} variant={variant} />
      </div>
      <p className="mt-2 type-caption text-slate-500">
        Within {FUTURE_SKEW_TOLERANCE_MS / 60_000} minutes of the future the label clamps to now; beyond it the cell shows the absolute moment in the warning tone and reports the skew once — the impossible value never renders as the calmest one.
      </p>
    </Region>
  );
}
