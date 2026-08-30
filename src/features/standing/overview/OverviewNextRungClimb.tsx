// The climb: the fleet's daily average across the period as ONE line, with the next rung's floor
// drawn as a rule it has to cross. Path and rule live in a percent-space SVG stretched to the box
// (non-scaling strokes); the four labels are real HTML on the type scale, positioned by the same
// percentages. No hover — Felton has none; the two end labels are the whole annotation.

import { LEVEL_HEX } from "@/lib/ui";
import { shortDateSafe } from "@/components/ui/format";
import type { MaturityLevel } from "@/lib/types";
import type { TrendPoint } from "@/components/report/TrendChart";

export function OverviewNextRungClimb({ points, level, next }: { points: TrendPoint[]; level: MaturityLevel; next: MaturityLevel | null }) {
  const n = points.length;
  if (n < 2) {
    return (
      <p className="border-t border-divider pt-4 type-body text-slate-500">
        {n === 0 ? "No daily readings in this window." : "One reading so far — the climb line starts with the next scan."}
      </p>
    );
  }

  const scores = points.map((p) => p.score);
  const floor = next?.band[0] ?? null;
  const lo = Math.max(0, Math.min(...scores, level.band[0]) - 3);
  const hi = Math.min(100, Math.max(...scores, floor ?? level.band[1]) + 3);
  const x = (i: number) => (i / (n - 1)) * 100;
  const y = (s: number) => 100 - ((s - lo) / (hi - lo)) * 100;
  const path = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(2)},${y(p.score).toFixed(2)}`).join(" ");
  const first = points[0]!;
  const last = points[n - 1]!;

  return (
    <figure className="border-t border-divider pt-4">
      <div className="relative h-44 w-full">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full" aria-hidden>
          {floor !== null && (
            <line x1="0" x2="100" y1={y(floor)} y2={y(floor)} stroke={LEVEL_HEX[next!.id]} strokeOpacity="0.45" vectorEffect="non-scaling-stroke" />
          )}
          <path d={path} fill="none" stroke={LEVEL_HEX[level.id]} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        </svg>
        {floor !== null && (
          <span className="absolute right-0 -translate-y-full pb-1 type-caption" style={{ top: `${y(floor)}%`, color: LEVEL_HEX[next!.id] }}>
            {next!.name} · {floor}
          </span>
        )}
      </div>
      <figcaption className="mt-2 flex items-baseline justify-between type-caption text-slate-500">
        <span>
          {first.score} · {shortDateSafe(first.at)}
        </span>
        <span className="text-slate-300">
          {last.score} · {shortDateSafe(last.at)}
        </span>
      </figcaption>
    </figure>
  );
}
