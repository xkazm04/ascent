"use client";

// The scatter itself — extracted out of AiRoiQuadrant so that file stays under the 200-LOC cap
// (AGENTS.md). Pure presentational: all the scale/quadrant math is computed by the parent and passed
// down as plain numbers/functions so this file stays a JSX layout, not a second copy of the model.

import { VERDICT_META, fmtMoney, type AiDeliveryModel, type AiRepoRoi, type Verdict } from "./aiDeliveryModel";

const W = 480;
const H = 356;
const PAD_L = 44;
const PAD_R = 14;
const PAD_T = 44;
const PAD_B = 52;

export function AiRoiQuadrantMap({
  model,
  noCostSource,
  active,
  setActive,
  hover,
  setHover,
  px,
  py,
  seatR,
  splitX,
  splitY,
}: {
  model: AiDeliveryModel;
  noCostSource: boolean;
  active: Verdict | null;
  setActive: (v: Verdict | null) => void;
  hover: AiRepoRoi | null;
  setHover: (r: AiRepoRoi | null) => void;
  px: (v: number) => number;
  py: (v: number) => number;
  seatR: (seats: number) => number;
  splitX: number;
  splitY: number;
}) {
  const capTop = PAD_T - 20;
  const capBottom = H - PAD_B + 22;
  const quadCaptions = [
    { x: PAD_L + 2, y: capTop, anchor: "start" as const, text: "idle — paying, little AI", hex: "#f97316" },
    { x: W - PAD_R - 2, y: capTop, anchor: "end" as const, text: "invested & active", hex: "#22c55e" },
    { x: PAD_L + 2, y: capBottom, anchor: "start" as const, text: "starter", hex: "#64748b" },
    { x: W - PAD_R - 2, y: capBottom, anchor: "end" as const, text: "lean — high AI, low cost", hex: "#7bbcff" },
  ];

  return (
    <div className="relative rounded-2xl border border-divider bg-surface-strong/40 p-3">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="AI adoption versus AI spend, one point per repository; color is the ROI verdict.">
        {/* quadrant tints */}
        <rect x={PAD_L} y={PAD_T} width={splitX - PAD_L} height={splitY - PAD_T} fill="#f97316" fillOpacity={0.05} />
        <rect x={splitX} y={PAD_T} width={W - PAD_R - splitX} height={splitY - PAD_T} fill="#22c55e" fillOpacity={0.05} />
        {/* axes */}
        <line x1={PAD_L} y1={H - PAD_B} x2={W - PAD_R} y2={H - PAD_B} stroke="#334155" />
        <line x1={PAD_L} y1={PAD_T} x2={PAD_L} y2={H - PAD_B} stroke="#334155" />
        {/* split lines */}
        <line x1={splitX} y1={PAD_T} x2={splitX} y2={H - PAD_B} stroke="#1e293b" strokeDasharray="3 3" />
        <line x1={PAD_L} y1={splitY} x2={W - PAD_R} y2={splitY} stroke="#1e293b" strokeDasharray="3 3" />
        {/* axis labels */}
        <text x={(PAD_L + W - PAD_R) / 2} y={H - 8} textAnchor="middle" fontSize="11" fontFamily="monospace" className="fill-slate-500">
          AI reach (% of PRs) →
        </text>
        <text x={12} y={(PAD_T + H - PAD_B) / 2} textAnchor="middle" fontSize="11" fontFamily="monospace" className="fill-slate-500" transform={`rotate(-90 12 ${(PAD_T + H - PAD_B) / 2})`}>
          Spend $/mo →
        </text>
        {quadCaptions.map((c) => (
          <text key={c.text} x={c.x} y={c.y} textAnchor={c.anchor} fontSize="9" fontFamily="monospace" className="pointer-events-none" fill={c.hex} fillOpacity={0.75}>
            {c.text}
          </text>
        ))}
        {noCostSource && (
          <text
            x={(PAD_L + W - PAD_R) / 2}
            y={(PAD_T + H - PAD_B) / 2}
            textAnchor="middle"
            fontSize="14"
            fontFamily="monospace"
            className="pointer-events-none select-none fill-slate-600"
            opacity={0.5}
          >
            sample spend
          </text>
        )}
        {/* points */}
        {model.repos.map((r) => {
          const faded = active != null && r.verdict !== active;
          return (
            <circle
              key={r.fullName}
              cx={px(r.aiInvolvedRate)}
              cy={py(r.monthlySpend)}
              r={seatR(r.seats)}
              fill={VERDICT_META[r.verdict].hex}
              fillOpacity={0.85}
              opacity={faded ? 0.15 : 1}
              stroke="#04070e"
              strokeWidth={0.75}
              className="cursor-pointer transition-opacity duration-300 motion-reduce:transition-none"
              onMouseEnter={() => setHover(r)}
              onMouseLeave={() => setHover(null)}
            >
              <title>{noCostSource ? `${r.name} — AI reach ${r.aiInvolvedRate}% · ${VERDICT_META[r.verdict].label} (spend is a sample)` : `${r.name} — AI reach ${r.aiInvolvedRate}%, ${fmtMoney(r.monthlySpend)}/mo, ${r.seats} seats · ${VERDICT_META[r.verdict].label}`}</title>
            </circle>
          );
        })}
      </svg>

      {hover && (
        <div
          className="pointer-events-none absolute z-10 rounded-lg border border-divider bg-surface-strong/95 px-2.5 py-1.5 shadow-lg"
          style={{ left: `${(px(hover.aiInvolvedRate) / W) * 100}%`, top: `${(py(hover.monthlySpend) / H) * 100}%`, transform: "translate(-50%, calc(-100% - 10px))" }}
        >
          <div className="whitespace-nowrap font-mono text-sm font-bold text-white">{hover.name}</div>
          <div className="whitespace-nowrap font-mono text-xs text-slate-400">
            {hover.aiInvolvedRate}% AI{noCostSource ? " · sample spend" : ` · ${fmtMoney(hover.monthlySpend)}/mo · ${hover.seats} seats`}
          </div>
        </div>
      )}

      {/* verdict legend — click to filter the cloud */}
      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        {(Object.keys(VERDICT_META) as Verdict[]).map((v) => {
          const on = active === v;
          const n = model.summary.counts[v];
          return (
            <button
              key={v}
              type="button"
              disabled={n === 0}
              onClick={() => setActive(on ? null : v)}
              aria-pressed={on}
              className={`focus-ring inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-xs transition disabled:opacity-30 ${on ? "border-current" : "border-divider hover:border-slate-600"}`}
              style={{ color: VERDICT_META[v].hex }}
            >
              <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: VERDICT_META[v].hex }} />
              {VERDICT_META[v].label} <span className="tabular-nums text-slate-500">{n}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
