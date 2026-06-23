// Automation × Production scatter (P3) — the headline portfolio view the design calls the whole payoff:
// each repo is a point (x = automation readiness, y = production readiness), so the "automatable but not
// production-ready" quadrant (and its opposite) jumps out. Server-safe SVG (no client hooks); points are
// colored by production band. Quadrant split at 65 (the production/L4 cutoff).

import { bandColor } from "@/lib/org/passport-display";

export interface ScatterPoint {
  name: string;
  x: number; // automation score 0..100
  y: number; // production score 0..100
  band: string;
}

const W = 440;
const H = 340;
const PAD = 40;
const SPLIT = 65; // automation×production quadrant cutoff (the L4 / production boundary)

const px = (v: number) => PAD + (Math.max(0, Math.min(100, v)) / 100) * (W - 2 * PAD);
const py = (v: number) => H - PAD - (Math.max(0, Math.min(100, v)) / 100) * (H - 2 * PAD);

export function PassportScatter({ points }: { points: ScatterPoint[] }) {
  const splitX = px(SPLIT);
  const splitY = py(SPLIT);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Automation readiness versus production readiness, one point per repository">
      {/* quadrant fills (faint) */}
      <rect x={splitX} y={PAD} width={W - PAD - splitX} height={splitY - PAD} fill="rgba(132,204,22,0.06)" />
      <rect x={splitX} y={splitY} width={W - PAD - splitX} height={H - PAD - splitY} fill="rgba(217,119,6,0.06)" />
      {/* axes */}
      <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} stroke="#334155" />
      <line x1={PAD} y1={PAD} x2={PAD} y2={H - PAD} stroke="#334155" />
      {/* quadrant split lines */}
      <line x1={splitX} y1={PAD} x2={splitX} y2={H - PAD} stroke="#1e293b" strokeDasharray="3 3" />
      <line x1={PAD} y1={splitY} x2={W - PAD} y2={splitY} stroke="#1e293b" strokeDasharray="3 3" />
      {/* axis labels */}
      <text x={W / 2} y={H - 8} textAnchor="middle" className="fill-slate-500" fontSize="11" fontFamily="monospace">Automation readiness →</text>
      <text x={12} y={H / 2} textAnchor="middle" fontSize="11" fontFamily="monospace" className="fill-slate-500" transform={`rotate(-90 12 ${H / 2})`}>Production readiness →</text>
      {/* quadrant captions */}
      <text x={W - PAD - 4} y={PAD + 12} textAnchor="end" fontSize="9" fontFamily="monospace" className="fill-emerald-500/70">ready to ship</text>
      <text x={W - PAD - 4} y={H - PAD - 6} textAnchor="end" fontSize="9" fontFamily="monospace" className="fill-orange-400/70">automatable, not prod-ready</text>
      <text x={PAD + 4} y={PAD + 12} textAnchor="start" fontSize="9" fontFamily="monospace" className="fill-slate-500">prod-grade, agent-hostile</text>
      {/* points */}
      {points.map((p, i) => (
        <g key={`${p.name}-${i}`}>
          <circle cx={px(p.x)} cy={py(p.y)} r={5} fill={bandColor(p.band)} fillOpacity={0.85} stroke="#04070e" strokeWidth={0.75}>
            <title>{`${p.name} — automation ${p.x}, production ${p.y} (${p.band})`}</title>
          </circle>
        </g>
      ))}
    </svg>
  );
}
