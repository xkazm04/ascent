// The drift plane for the "Map vs territory" variant — a dependency-free SVG scatter in the house
// chart idiom. X is how fast the TERRITORY moves (commits/week); Y is how current the MAP is
// (context potency). The two axes together produce the only quadrant anyone actually cares about:
// fast-moving code under a stale map, where an agent is confidently told the wrong thing.
//
// Extracted from ContextMapTerritory.tsx for the 300-LOC rule.

import { scoreHex, heatCell } from "@/lib/ui";
import type { RepoContextHealth } from "./contextHealthMock";

const W = 640;
const H = 300;
const PAD = { l: 46, r: 16, t: 16, b: 34 };

/** Compressed X so one hyperactive monorepo doesn't flatten the rest of the fleet against the axis. */
function xScale(commitsPerWeek: number, max: number): number {
  const c = Math.log1p(Math.max(0, commitsPerWeek)) / Math.log1p(Math.max(1, max));
  return PAD.l + c * (W - PAD.l - PAD.r);
}

function yScale(potency: number): number {
  return PAD.t + (1 - Math.max(0, Math.min(100, potency)) / 100) * (H - PAD.t - PAD.b);
}

const QUADRANTS = [
  { key: "fiction", label: "Fiction", note: "fast code · stale map", x: 0.72, y: 0.86, hex: scoreHex(15) },
  { key: "mapped", label: "Well mapped", note: "fast code · current map", x: 0.72, y: 0.12, hex: scoreHex(90) },
  { key: "preserved", label: "Preserved", note: "quiet code · current map", x: 0.09, y: 0.12, hex: scoreHex(70) },
  { key: "dormant", label: "Dormant", note: "quiet code · stale map", x: 0.09, y: 0.86, hex: scoreHex(45) },
] as const;

export function DriftQuadrant({ rows }: { rows: RepoContextHealth[] }) {
  const maxC = Math.max(1, ...rows.map((r) => r.commitsPerWeek));
  const midX = PAD.l + (W - PAD.l - PAD.r) / 2;
  const midY = PAD.t + (H - PAD.t - PAD.b) / 2;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Repositories plotted by change rate against context currency">
      {/* Quadrant rules — the divider hairline, same as every other chart in the app. */}
      <line x1={midX} y1={PAD.t} x2={midX} y2={H - PAD.b} stroke="#1e293b" strokeWidth={1} />
      <line x1={PAD.l} y1={midY} x2={W - PAD.r} y2={midY} stroke="#1e293b" strokeWidth={1} />
      <line x1={PAD.l} y1={PAD.t} x2={PAD.l} y2={H - PAD.b} stroke="#1e293b" strokeWidth={1} />
      <line x1={PAD.l} y1={H - PAD.b} x2={W - PAD.r} y2={H - PAD.b} stroke="#1e293b" strokeWidth={1} />

      {QUADRANTS.map((q) => (
        <text
          key={q.key}
          x={PAD.l + q.x * (W - PAD.l - PAD.r)}
          y={PAD.t + q.y * (H - PAD.t - PAD.b)}
          fill={q.hex}
          fillOpacity={0.75}
          fontSize={11}
          fontFamily="ui-monospace, monospace"
          letterSpacing={1.6}
        >
          {q.label.toUpperCase()}
          <tspan x={PAD.l + q.x * (W - PAD.l - PAD.r)} dy={13} fill="#475569" letterSpacing={0.8}>
            {q.note}
          </tspan>
        </text>
      ))}

      {/* Axis labels */}
      <text x={W / 2} y={H - 8} textAnchor="middle" fill="#475569" fontSize={10} fontFamily="ui-monospace, monospace" letterSpacing={1.6}>
        TERRITORY — COMMITS / WEEK →
      </text>
      <text x={12} y={H / 2} textAnchor="middle" fill="#475569" fontSize={10} fontFamily="ui-monospace, monospace" letterSpacing={1.6} transform={`rotate(-90 12 ${H / 2})`}>
        MAP — CONTEXT STILL CURRENT →
      </text>

      {rows.map((r) => {
        const cx = xScale(r.commitsPerWeek, maxC);
        const cy = yScale(r.potency);
        // A repo with NO context is not a zero-potency point — it's uncharted. Hollow ring on the floor.
        if (!r.present) {
          return (
            <g key={r.fullName}>
              <circle cx={cx} cy={H - PAD.b} r={4} fill="none" stroke="#475569" strokeWidth={1.2} strokeDasharray="2 2" />
              <title>{`${r.fullName} — uncharted (no agent context, ${r.commitsPerWeek}/wk)`}</title>
            </g>
          );
        }
        const cell = heatCell(r.quality, 0.85);
        const rad = 4 + Math.min(5, Math.log1p(r.churnSinceEdit) * 1.1);
        return (
          <g key={r.fullName}>
            <circle cx={cx} cy={cy} r={rad} fill={cell.fill} stroke={scoreHex(r.quality)} strokeWidth={1} strokeOpacity={0.9} />
            <title>{`${r.fullName} — ${r.potency}% current · quality ${r.quality} · ${r.commitsPerWeek}/wk · ${r.churnSinceEdit} commits since last edit`}</title>
          </g>
        );
      })}
    </svg>
  );
}

/** Which quadrant a repo falls in — reused for the callout list under the plane. */
export function quadrantOf(r: RepoContextHealth, medianCommits: number): "uncharted" | "fiction" | "mapped" | "preserved" | "dormant" {
  if (!r.present) return "uncharted";
  const fast = r.commitsPerWeek >= medianCommits;
  const current = r.potency >= 50;
  if (fast && !current) return "fiction";
  if (fast && current) return "mapped";
  if (!fast && current) return "preserved";
  return "dormant";
}
