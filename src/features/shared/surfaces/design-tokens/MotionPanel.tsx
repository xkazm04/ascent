"use client";

// motion-tokens: the duration ladder and the easing roles as a table (full column and reduced
// column, the latter the epsilon rebinding the scope root already carries), a "which step?" picker
// where the answer is categorical, and a chip that transitions on `var(--sx-duration-<step>)`
// without ever reading the preference: under `reduced` the root rebinds the travel steps to 1ms and
// the chip complies without knowing. Play is a one-shot; there is no loop here to pause.

import { useState } from "react";
import { CHANGES, DURATION_MS, EASING, ladderFor, STEPS, STEP_USE, type DurationStep } from "./motionLadder";
import { BTN, Readout, Region, TH } from "./sceneParts";

export function MotionRegion({ reduced }: { reduced: boolean }) {
  const [picks, setPicks] = useState<Record<string, DurationStep>>({ tint: "base", row: "base", modal: "base" });
  const [step, setStep] = useState<DurationStep>("base");
  const [out, setOut] = useState(false);
  const ladder = ladderFor(reduced);
  const right = CHANGES.filter((c) => picks[c.id] === c.step).length;
  return (
    <Region technique="motion-tokens" title="A ladder, not a continuum" note="Pick by what is moving. In-between values are vocabulary violations. Reduced is a rebinding at the root.">
      <div className="grid gap-3 sm:grid-cols-[1fr_1fr]">
        <table className="w-full self-start type-caption">
          <thead>
            <tr>
              <th className={TH}>step</th>
              <th className={TH}>full</th>
              <th className={TH}>reduced</th>
              <th className={TH}>use</th>
            </tr>
          </thead>
          <tbody>
            {STEPS.map((s) => (
              <tr key={s} className="border-t border-divider text-slate-300" data-step={s} data-step-ms={ladder[s]}>
                <td className="py-0.5 font-mono">{s}</td>
                <td className="py-0.5 tabular-nums">{DURATION_MS[s]}ms</td>
                <td className={`py-0.5 tabular-nums ${reduced && ladder[s] !== DURATION_MS[s] ? "text-accent-soft" : ""}`}>{ladder[s]}ms</td>
                <td className="py-0.5 text-slate-500">{STEP_USE[s]}</td>
              </tr>
            ))}
            {(Object.keys(EASING) as (keyof typeof EASING)[]).map((r) => (
              <tr key={r} className="border-t border-divider text-slate-500">
                <td className="py-0.5 font-mono text-slate-300">ease-{r}</td>
                <td className="py-0.5" colSpan={3}>
                  {r === "expressive" && reduced ? "flattened to move under reduction" : EASING[r]}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="space-y-2">
          <p className="type-caption text-slate-500">which step does each change belong to?</p>
          {CHANGES.map((c) => (
            <label key={c.id} className="flex items-center justify-between gap-2 type-caption text-slate-300">
              <span>{c.label}</span>
              <select value={picks[c.id]} onChange={(e) => setPicks((p) => ({ ...p, [c.id]: e.target.value as DurationStep }))} className="focus-ring rounded-md border border-divider bg-surface/40 px-1 py-0.5 font-mono type-caption text-slate-200" aria-label={`Step for ${c.label}`}>
                {STEPS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
          ))}
          <Readout label="on the ladder" value={<span data-ladder-right={right}>{`${right} / ${CHANGES.length}`}</span>} tone={right === CHANGES.length ? "text-success-soft" : "text-slate-200"} />
          <div className="flex items-center gap-2 pt-1">
            <span
              className="inline-block h-5 w-5 rounded-md bg-accent"
              data-chip-step={step}
              style={{ transform: out ? "translateX(72px)" : "translateX(0)", transition: `transform var(--sx-duration-${step}) var(--sx-ease-move)` }}
              aria-hidden
            />
            <span className="w-16" />
            <select value={step} onChange={(e) => setStep(e.target.value as DurationStep)} className="focus-ring rounded-md border border-divider bg-surface/40 px-1 py-0.5 font-mono type-caption text-slate-200" aria-label="Chip duration step">
              {STEPS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <button type="button" className={BTN} onClick={() => setOut((o) => !o)}>
              play
            </button>
          </div>
          <p className="type-caption text-slate-500">The chip references the variable; the scope root binds it; the preference is honored once, at the root.</p>
        </div>
      </div>
    </Region>
  );
}
