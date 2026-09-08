"use client";

// preference-respect: one signal per preference, read at one boundary, derived everywhere. The
// region is the signal's dashboard and its only write side: `reduced` is displayed with its source
// (the frame), text scale and forced colors are set here and flow to every other region through the
// Scene. The right column states what honoring the preference must preserve — the contract, not the
// detection. Contrast has no gate in this scene; the row says so rather than rendering a pass.

import { PRESERVES, SCALES, type PrefSignal, type TextScale } from "./signal";
import { BTN, BTN_ON, Region, Switch } from "./sceneParts";

export function PreferenceRegion({ signal, onScale, onForced }: { signal: PrefSignal; onScale: (s: TextScale) => void; onForced: (f: boolean) => void }) {
  return (
    <Region technique="preference-respect" title="One signal, every surface derives" note="Read once at a boundary, forceable here, honored below. A preference is a promise to the tenth screen too.">
      <table className="w-full type-caption">
        <thead>
          <tr className="text-left text-slate-500">
            <th className="font-normal">preference</th>
            <th className="font-normal">source</th>
            <th className="font-normal">signal</th>
            <th className="hidden font-normal sm:table-cell">honored means</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-t border-divider align-top text-slate-300">
            <td className="py-1.5">reduced motion</td>
            <td className="py-1.5 text-slate-500">frame: OS query OR simulate toggle</td>
            <td className="py-1.5">
              <span className="type-mono-sm tabular-nums" data-signal-reduced={signal.reduced}>
                {signal.reduced ? "reduce" : "no-preference"}
              </span>
            </td>
            <td className="hidden py-1.5 text-slate-500 sm:table-cell">{PRESERVES.reduced}</td>
          </tr>
          <tr className="border-t border-divider align-top text-slate-300">
            <td className="py-1.5">text scale</td>
            <td className="py-1.5 text-slate-500">in-app setting (this row)</td>
            <td className="py-1.5">
              <div className="flex gap-1" role="group" aria-label="Text scale">
                {SCALES.map((s) => (
                  <button key={s} type="button" aria-pressed={signal.scale === s} className={signal.scale === s ? BTN_ON : BTN} onClick={() => onScale(s)}>
                    {s}%
                  </button>
                ))}
              </div>
            </td>
            <td className="hidden py-1.5 text-slate-500 sm:table-cell">{PRESERVES.scale}</td>
          </tr>
          <tr className="border-t border-divider align-top text-slate-300">
            <td className="py-1.5">forced colors</td>
            <td className="py-1.5 text-slate-500">in-app setting (this row)</td>
            <td className="py-1.5">
              <Switch label="Forced colors" on={signal.forced} onToggle={() => onForced(!signal.forced)} />
            </td>
            <td className="hidden py-1.5 text-slate-500 sm:table-cell">{PRESERVES.forced}</td>
          </tr>
          <tr className="border-t border-divider align-top text-slate-300">
            <td className="py-1.5">contrast floor</td>
            <td className="py-1.5 text-slate-500">token definition site</td>
            <td className="py-1.5 text-warn" data-signal-contrast="untested">
              no gate here — untested
            </td>
            <td className="hidden py-1.5 text-slate-500 sm:table-cell">a floor with a number is a floor a build can enforce; this scene has none, so it says so</td>
          </tr>
        </tbody>
      </table>
    </Region>
  );
}
