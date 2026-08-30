// The Altimeter's elevation gauge: a vertical 0–100 scale whose strata are the five maturity levels
// (LEVELS bands, tinted with their LEVEL_HEX), a needle at the fleet average in its score colour,
// and — when the window has a baseline — a dashed ghost mark where the needle sat a period ago, so
// the delta reads as needle MOVEMENT, not just a signed number. Dependency-free SVG at its natural
// size (no viewBox scaling), so the L1–L5 labels render at the type-micro floor. No hooks.

import { LEVELS, clamp } from "@/lib/maturity/model";
import { LEVEL_HEX, scoreHex } from "@/lib/ui";

const W = 104;
const H = 236;
const TOP = 10;
const SPAN = H - TOP * 2;
/** Score → y (100 at the top, 0 at the bottom). */
const y = (v: number) => TOP + ((100 - clamp(v)) / 100) * SPAN;

export function OverviewAltimeterGauge({ overall, delta }: { overall: number; delta: number | null }) {
  const prev = delta === null ? null : clamp(overall - delta);
  const color = scoreHex(overall);
  const label =
    `Fleet standing ${overall} of 100` +
    (prev !== null && prev !== overall ? `, moved from ${prev} a period ago` : "") +
    `; levels L1 to L5 marked on the scale`;
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} className="shrink-0">
      <title>{label}</title>
      {/* strata — one band per level, bottom-up */}
      {LEVELS.map((l) => {
        const top = y(l.band[1] + 1);
        const bottom = y(l.band[0]);
        return (
          <g key={l.id}>
            <rect x={44} y={top} width={22} height={bottom - top} fill={LEVEL_HEX[l.id]} opacity={0.14} />
            <line x1={44} x2={66} y1={bottom} y2={bottom} stroke="var(--color-divider)" strokeWidth={1} />
            <text x={72} y={(top + bottom) / 2 + 4} className="type-micro fill-slate-500 font-mono">
              {l.id}
            </text>
          </g>
        );
      })}
      <line x1={44} x2={66} y1={y(100)} y2={y(100)} stroke="var(--color-divider)" strokeWidth={1} />
      {/* ticks every 10, longer at 50 */}
      {Array.from({ length: 11 }, (_, i) => i * 10).map((v) => (
        <line key={v} x1={v % 50 === 0 ? 34 : 38} x2={44} y1={y(v)} y2={y(v)} stroke="var(--color-divider)" strokeWidth={1} />
      ))}
      {/* ghost needle — where the fleet stood a period ago */}
      {prev !== null && prev !== overall && (
        <g opacity={0.8}>
          <line x1={30} x2={66} y1={y(prev)} y2={y(prev)} stroke="var(--color-tone-flat)" strokeWidth={1} strokeDasharray="2 3" />
          <line x1={26} x2={26} y1={y(prev)} y2={y(overall)} stroke={color} strokeWidth={2} strokeLinecap="round" />
        </g>
      )}
      {/* the needle */}
      <polygon points={`${18},${y(overall) - 5} ${18},${y(overall) + 5} ${26},${y(overall)}`} fill={color} />
      <line x1={26} x2={66} y1={y(overall)} y2={y(overall)} stroke={color} strokeWidth={2} strokeLinecap="round" />
    </svg>
  );
}
