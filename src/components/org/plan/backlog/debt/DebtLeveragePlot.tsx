// The plot for VARIANT C (Leverage Map): repos placed on a velocity × quality plane.
//   X = AI-authored share of merged PRs (how much leverage the repo is taking)
//   Y = rework rate (what that leverage costs), inverted so UP = healthier
//   area = overdue recommendation debt in projected score points (the real half)
// Split at the FLEET MEDIAN on both axes, so the quadrants are relative to this org, not to an
// invented industry constant. Dependency-free SVG; entrance-only motion.

import { OVERDUE_ACCENT } from "@/components/org/shared/backlogShared";
import type { DebtFleet, RepoDebt } from "./debtModel";
import { pct } from "./debtModel";
import { pressureHex } from "./debtParts";

export type QuadrantId = "leveraged" | "compounding" | "thrashing" | "manual";

export const QUADRANT: Record<QuadrantId, { label: string; blurb: string; hex: string }> = {
  leveraged: { label: "Leveraged", blurb: "High AI share, rework below median — the pattern to copy.", hex: "#22c55e" },
  compounding: { label: "Compounding", blurb: "High AI share bought with rework above median.", hex: "#ef4444" },
  thrashing: { label: "Thrashing", blurb: "Rework above median without the AI leverage to show for it.", hex: OVERDUE_ACCENT },
  manual: { label: "Manual", blurb: "Little AI share, little rework — leverage still on the table.", hex: "#64748b" },
};

/** Which quadrant a repo falls in, relative to the fleet medians. */
export function quadrantOf(row: RepoDebt, fleet: DebtFleet): QuadrantId {
  const hotAi = row.q.aiAuthoredShare >= fleet.medianAiShare;
  const hotRework = row.q.reworkRate >= fleet.medianRework;
  if (hotAi) return hotRework ? "compounding" : "leveraged";
  return hotRework ? "thrashing" : "manual";
}

const W = 560;
const H = 380;
const PAD = { l: 44, r: 16, t: 16, b: 38 };

export function DebtLeveragePlot({
  fleet,
  selected,
  onSelect,
}: {
  fleet: DebtFleet;
  selected: string | null;
  onSelect: (repo: string | null) => void;
}) {
  const innerW = W - PAD.l - PAD.r;
  const innerH = H - PAD.t - PAD.b;
  const maxRework = Math.max(0.3, ...fleet.rows.map((r) => r.q.reworkRate)) * 1.1;
  const maxPrincipal = Math.max(1, ...fleet.rows.map((r) => r.principal));

  const px = (v: number) => PAD.l + v * innerW;
  const py = (v: number) => PAD.t + (v / maxRework) * innerH; // top = 0 rework = healthy
  const radius = (r: RepoDebt) => 5 + Math.sqrt(r.principal / maxPrincipal) * 16;

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="animate-fade-in h-auto w-full"
      role="img"
      aria-label="Repositories plotted by AI-authored share against rework rate, sized by overdue debt"
    >
      {/* quadrant beds, split at the fleet medians */}
      <rect x={px(fleet.medianAiShare)} y={PAD.t} width={px(1) - px(fleet.medianAiShare)} height={py(fleet.medianRework) - PAD.t} fill={QUADRANT.leveraged.hex} opacity={0.05} />
      <rect x={px(fleet.medianAiShare)} y={py(fleet.medianRework)} width={px(1) - px(fleet.medianAiShare)} height={PAD.t + innerH - py(fleet.medianRework)} fill={QUADRANT.compounding.hex} opacity={0.07} />
      <rect x={PAD.l} y={py(fleet.medianRework)} width={px(fleet.medianAiShare) - PAD.l} height={PAD.t + innerH - py(fleet.medianRework)} fill={QUADRANT.thrashing.hex} opacity={0.05} />

      <line x1={px(fleet.medianAiShare)} x2={px(fleet.medianAiShare)} y1={PAD.t} y2={PAD.t + innerH} stroke="var(--color-divider)" strokeDasharray="3 4" />
      <line x1={PAD.l} x2={PAD.l + innerW} y1={py(fleet.medianRework)} y2={py(fleet.medianRework)} stroke="var(--color-divider)" strokeDasharray="3 4" />

      {(Object.keys(QUADRANT) as QuadrantId[]).map((id) => {
        const right = id === "leveraged" || id === "compounding";
        const top = id === "leveraged" || id === "manual";
        return (
          <text
            key={id}
            x={right ? PAD.l + innerW - 6 : PAD.l + 6}
            y={top ? PAD.t + 14 : PAD.t + innerH - 6}
            textAnchor={right ? "end" : "start"}
            fontSize={10}
            letterSpacing={2}
            fill={QUADRANT[id].hex}
            opacity={0.75}
            className="font-mono uppercase"
          >
            {QUADRANT[id].label}
          </text>
        );
      })}

      {fleet.rows.map((r) => {
        const on = selected === r.repo;
        return (
          <g
            key={r.repo}
            onMouseEnter={() => onSelect(r.repo)}
            onMouseLeave={() => onSelect(null)}
            className="cursor-pointer"
          >
            <circle
              cx={px(r.q.aiAuthoredShare)}
              cy={py(r.q.reworkRate)}
              r={radius(r)}
              fill={pressureHex(r.pressure)}
              fillOpacity={on ? 0.5 : 0.22}
              stroke={pressureHex(r.pressure)}
              strokeWidth={on ? 2 : 1}
            />
            {(on || r.principal >= maxPrincipal * 0.55) && (
              <text
                x={px(r.q.aiAuthoredShare)}
                y={py(r.q.reworkRate) - radius(r) - 5}
                textAnchor="middle"
                fontSize={10}
                fill={on ? "#fff" : "#94a3b8"}
                className="font-mono"
              >
                {r.repoName}
              </text>
            )}
          </g>
        );
      })}

      {/* axes */}
      <text x={PAD.l + innerW / 2} y={H - 8} textAnchor="middle" fontSize={9} letterSpacing={2} fill="#475569" className="font-mono uppercase">
        AI-authored share of merged PRs →
      </text>
      <text x={12} y={PAD.t + innerH / 2} textAnchor="middle" fontSize={9} letterSpacing={2} fill="#475569" className="font-mono uppercase" transform={`rotate(-90 12 ${PAD.t + innerH / 2})`}>
        ← rework rate
      </text>
      <text x={PAD.l} y={H - 22} fontSize={9} fill="#475569" className="font-mono">0%</text>
      <text x={PAD.l + innerW} y={H - 22} textAnchor="end" fontSize={9} fill="#475569" className="font-mono">100%</text>
      <text x={PAD.l - 6} y={PAD.t + 8} textAnchor="end" fontSize={9} fill="#475569" className="font-mono">0%</text>
      <text x={PAD.l - 6} y={PAD.t + innerH} textAnchor="end" fontSize={9} fill="#475569" className="font-mono">{pct(maxRework)}</text>
    </svg>
  );
}
