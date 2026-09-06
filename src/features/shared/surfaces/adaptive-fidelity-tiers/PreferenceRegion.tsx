// preference-short-circuits-measurement: an expressed preference — the frame's `reduced` (the OS
// setting or the simulate toggle) or the product's own quality control — decides whether the probe
// is CREATED, before any scheduling: no idle request, no timer, no buffer, no windows. The ledger
// below lists what exists. A measured tier is a default for people who have not said what they
// want; the way back to it is the "auto" chip, and the probe it creates is fresh, not resumed.

import type { Preference, ProbeState } from "./probe";
import { BTN, BTN_ON, Readout, Region, TierChip } from "./parts";

const CHOICES: readonly { value: Preference; label: string }[] = [
  { value: "auto", label: "auto (measured)" },
  { value: "full", label: "full" },
  { value: "floor", label: "floor" },
];

export function PreferenceRegion({ state, reduced, preference, onPreference }: { state: ProbeState; reduced: boolean; preference: Preference; onPreference: (p: Preference) => void }) {
  const created = state.phase !== "short-circuited";
  const exists = (thing: boolean) => (thing ? "exists" : "not created");
  return (
    <Region technique="preference-short-circuits-measurement" title="A stated preference retires the probe" note="Measure only when the measurement will change what you render. A user who asked for less has not asked to be profiled.">
      <div className="space-y-1">
        <Readout label="prefers-reduced-motion (frame)" value={<span data-pref-reduced={reduced}>{reduced ? "set → floor, no probe" : "not set"}</span>} tone={reduced ? "text-warn" : "text-slate-400"} />
        <Readout label="product quality control" value={<span data-pref-control={preference}>{preference}</span>} />
        <Readout label="resolved tier" value={<TierChip tier={state.tier} />} />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2" role="group" aria-label="Quality control">
        {CHOICES.map((c) => (
          <button key={c.value} type="button" className={preference === c.value ? BTN_ON : BTN} onClick={() => onPreference(c.value)} aria-pressed={preference === c.value} disabled={reduced}>
            {c.label}
          </button>
        ))}
        {reduced ? <span className="type-caption text-slate-500">the OS preference outranks the control</span> : null}
      </div>
      <ul className="mt-3 space-y-1" aria-label="What the probe created" data-probe-created={created}>
        {[
          ["idle request", created && state.deferral.requested],
          ["fallback timer", created && state.deferral.requested],
          ["sample buffer", created && state.phase !== "unmeasured"],
          ["windows closed", created && state.closed > 0],
        ].map(([label, thing]) => (
          <li key={String(label)} className="flex items-baseline justify-between type-caption">
            <span className="text-slate-400">{label}</span>
            <span className={`font-mono ${thing ? "text-slate-200" : "text-slate-600"}`}>{exists(Boolean(thing))}</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 type-caption text-slate-500">
        {created ? "No statement was made, so the measured tier is the default." : "The branch sits before the scheduling: a reader sees from the shape of the code that the machinery does not exist, not that it returns early."}
      </p>
    </Region>
  );
}
