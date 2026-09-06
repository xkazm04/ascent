// asymmetric-tier-transitions: one bad window drops a rung at once (a catastrophic one goes straight
// to the floor); a run of UPGRADE_RUN consecutive good windows climbs exactly one rung; a window in
// the dead band between the thresholds is neither and RESETS the counter. The ladder is three rungs,
// the counter has one increment path, and a tier change is a parameter change the effects re-read —
// nothing remounts. The buttons close a window of a chosen kind; the log shows what each one did.

import { TIERS } from "./budgets";
import type { WindowKind } from "./fixtures";
import { DOWNGRADE_MS, UPGRADE_MS, UPGRADE_RUN, type ProbeState } from "./probe";
import { BTN, Readout, Region, TierChip } from "./parts";

const KINDS: readonly { kind: WindowKind; label: string }[] = [
  { kind: "good", label: "good window" },
  { kind: "neutral", label: "neutral (dead band)" },
  { kind: "bad", label: "bad window" },
  { kind: "catastrophic", label: "catastrophic window" },
];

const VERDICT_TONE: Record<string, string> = { good: "text-accent-soft", neutral: "text-slate-400", bad: "text-danger", catastrophic: "text-danger", discarded: "text-slate-600" };

export function LadderRegion({ state, onWindow }: { state: ProbeState; onWindow: (kind: WindowKind) => void }) {
  const sampling = state.phase === "sampling";
  return (
    <Region technique="asymmetric-tier-transitions" title="Fall at once, climb slowly" note={`Down on one window ≥ ${DOWNGRADE_MS} ms. Up after ${UPGRADE_RUN} consecutive windows < ${UPGRADE_MS} ms. In between: neither, and the counter resets.`}>
      <div className="flex flex-wrap items-center gap-2" data-ladder={state.tier}>
        {TIERS.map((t) => (
          <span key={t} className={t === state.tier ? "" : "opacity-40"} aria-current={t === state.tier ? "true" : undefined}>
            <TierChip tier={t} />
          </span>
        ))}
        <span className="type-caption text-slate-500">{state.tierSource === "measured" ? "measured" : state.tierSource === "preference" ? "from the preference" : "declared default, unmeasured"}</span>
      </div>
      <div className="mt-3 space-y-1">
        <Readout label="upgrade run" value={<span data-upgrade-run={state.upgradeRun}>{`${state.upgradeRun} / ${UPGRADE_RUN}`}</span>} />
        <Readout label="dead band" value={`${UPGRADE_MS} – ${DOWNGRADE_MS} ms · resets the run`} tone="text-slate-400" />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {KINDS.map((k) => (
          <button key={k.kind} type="button" className={BTN} onClick={() => onWindow(k.kind)} disabled={!sampling} aria-label={`Close a ${k.label}`}>
            {k.label}
          </button>
        ))}
      </div>
      {!sampling ? (
        <p className="mt-2 type-caption text-slate-500">
          {state.phase === "short-circuited" ? "No probe exists: the preference chose the tier." : state.phase === "unmeasured" ? "Nothing has been sampled: the probe is waiting for idle." : "The probe has settled; re-arm it from the settle budget."}
        </p>
      ) : null}
      <ol className="mt-3 space-y-1" aria-label="Window log" data-window-log={state.windows.length}>
        {state.windows.length === 0 ? <li className="type-caption text-slate-600">no windows closed</li> : null}
        {state.windows.map((w) => (
          <li key={w.n} className="flex flex-wrap items-baseline justify-between gap-2 border-t border-divider pt-1 type-caption" data-window={w.n} data-window-verdict={w.verdict}>
            <span className="text-slate-500">
              #{w.n} <span className="font-mono tabular-nums text-slate-300">p90 {w.p90} ms</span> · <span className={VERDICT_TONE[w.verdict]}>{w.verdict}</span>
            </span>
            <span className="font-mono text-slate-400">
              {w.from === w.to ? `${w.to} · run ${w.run}` : `${w.from} → ${w.to}`}
            </span>
          </li>
        ))}
      </ol>
    </Region>
  );
}
