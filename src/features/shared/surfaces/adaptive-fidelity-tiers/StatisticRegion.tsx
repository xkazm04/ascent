// measured-not-declared-capability: the tier is computed from frame intervals the page itself
// produced, summarised per fixed-COUNT window by a high percentile — never a mean, never a declared
// signal. The chart is the last closed window: 60 bars, the two absolute thresholds as rules, the
// p90 as the marker that decides. The declared strip shows what a user-agent / core-count guess
// would have said about the same (fictional) device, and that it was not consulted. Every constant
// is shown with the sentence that derives it. No hooks: the probe state arrives as a prop.

import { DECLARED_DEVICE, TIER_COST_MS } from "./fixtures";
import { CATASTROPHIC_MS, DOWNGRADE_MS, PERCENTILE, UPGRADE_MS, UPGRADE_RUN, WINDOW_SAMPLES, type ProbeState } from "./probe";
import { BTN, Readout, Region } from "./parts";

const DERIVATIONS: readonly { name: string; value: string; why: string }[] = [
  { name: "WINDOW_SAMPLES", value: String(WINDOW_SAMPLES), why: "one second at 60 Hz; fixed in count so a slow device's window is the same statistic; one 80 ms GC pause sits under the p90" },
  { name: "PERCENTILE", value: `p${PERCENTILE * 100}`, why: "the tail — the 6 worst of 60 frames are what the user felt; the mean is dominated by the frames that were fine" },
  { name: "DOWNGRADE_MS", value: `${DOWNGRADE_MS} ms`, why: "two 60 Hz frames, absolute: one frame in ten dropped a whole frame, on any panel" },
  { name: "UPGRADE_MS", value: `${UPGRADE_MS} ms`, why: `one frame plus scheduling noise; the ${DOWNGRADE_MS - UPGRADE_MS} ms band above it is wider than the tier cost step (${TIER_COST_MS.full} ms)` },
  { name: "UPGRADE_RUN", value: String(UPGRADE_RUN), why: "three consecutive good windows — one good window is weak evidence (the page may have been idle)" },
];

const W = 360;
const H = 72;
const Y_MAX = CATASTROPHIC_MS + 20;
const y = (ms: number) => H - Math.min(H, (ms / Y_MAX) * H);

export function StatisticRegion({ state, onStraddled }: { state: ProbeState; onStraddled: () => void }) {
  const last = state.windows[0] ?? null;
  const measured = state.phase !== "short-circuited";
  const barW = W / WINDOW_SAMPLES;
  return (
    <Region technique="measured-not-declared-capability" title="Measure the page, not the device" note="A high percentile of this page's own frame intervals, over a fixed-count window. Nothing about the hardware is asked.">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-20 w-full" role="img" aria-label={last ? `Last window: p90 ${last.p90} ms` : "No window sampled yet"}>
        <line x1={0} x2={W} y1={y(DOWNGRADE_MS)} y2={y(DOWNGRADE_MS)} className="stroke-danger" strokeDasharray="3 3" strokeWidth={1} />
        <line x1={0} x2={W} y1={y(UPGRADE_MS)} y2={y(UPGRADE_MS)} className="stroke-slate-500" strokeDasharray="3 3" strokeWidth={1} />
        {last
          ? last.samples.map((ms, i) => (
              <rect key={i} x={i * barW + 0.5} y={y(ms)} width={Math.max(1, barW - 1)} height={H - y(ms)} className={ms >= DOWNGRADE_MS ? "fill-danger" : ms >= UPGRADE_MS ? "fill-slate-500" : "fill-accent"} />
            ))
          : null}
        {last ? <line x1={0} x2={W} y1={y(last.p90)} y2={y(last.p90)} className="stroke-white" strokeWidth={1.5} /> : null}
      </svg>
      <div className="mt-2 grid gap-1 sm:grid-cols-2">
        <Readout label="p90 (decides)" value={<span data-p90={last?.p90 ?? ""}>{last ? `${last.p90} ms` : measured ? "no window yet" : "not sampled"}</span>} tone={last && last.p90 >= DOWNGRADE_MS ? "text-danger" : "text-slate-200"} />
        <Readout label="mean (ignored)" value={last ? `${last.mean} ms` : "—"} tone="text-slate-500" />
        <Readout label="verdict" value={<span data-verdict={last?.verdict ?? "none"}>{last ? last.verdict : measured ? "—" : "preference resolved the tier"}</span>} />
        <Readout label="window" value={last ? `#${last.n} · ${WINDOW_SAMPLES} samples` : "—"} />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" className={BTN} onClick={onStraddled} disabled={state.phase !== "sampling"} aria-label="Close a window that straddled a visibility change">
          straddled window → discard
        </button>
        <span className="type-caption text-slate-500">A window across a tab switch reports a stopped clock, not a slow frame; it decides nothing.</span>
      </div>
      <div className="mt-3 rounded-lg border border-divider p-2" data-declared="not-consulted">
        <p className="type-caption text-slate-500">
          Declared: <span className="text-slate-300">{DECLARED_DEVICE.userAgent}</span> · {DECLARED_DEVICE.cores} cores · {DECLARED_DEVICE.memoryGb} GB → a guess would say{" "}
          <span className="text-slate-300">{DECLARED_DEVICE.guess}</span>. Not consulted; measured says <span className="text-slate-300" data-measured-tier={state.tier}>{state.tierSource === "measured" ? state.tier : `${state.tier} (${state.tierSource})`}</span>.
        </p>
      </div>
      <table className="mt-3 w-full type-caption">
        <thead>
          <tr className="text-left text-slate-500">
            <th className="font-normal">constant</th>
            <th className="font-normal">value</th>
            <th className="font-normal">derivation</th>
          </tr>
        </thead>
        <tbody>
          {DERIVATIONS.map((d) => (
            <tr key={d.name} className="border-t border-divider align-top text-slate-300">
              <td className="py-1 pr-2 font-mono">{d.name}</td>
              <td className="py-1 pr-2 font-mono tabular-nums">{d.value}</td>
              <td className="py-1 text-slate-500">{d.why}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Region>
  );
}
