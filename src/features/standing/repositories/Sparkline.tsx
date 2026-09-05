"use client";

// A tiny inline bar sparkline for dense fleet-table cells — the Repositories activity column renders
// a repo's trailing weekly-commit series here. Pure SVG, no deps: bars scale to the series max with a
// 1.5px floor so a non-zero week is always visible, and empty weeks draw a faint 1px stub so the grid
// reads as a full span. Renders nothing for an empty series (the caller shows "—" instead).

const ACCENT = "#3b9eff";

export function Sparkline({
  values,
  width = 72,
  height = 20,
  color = ACCENT,
  className = "",
  ariaLabel,
}: {
  values: number[];
  width?: number;
  height?: number;
  color?: string;
  className?: string;
  ariaLabel?: string;
}) {
  const n = values.length;
  if (n === 0) return null;
  const max = Math.max(...values, 1);
  const gap = 1;
  const barW = Math.max(1, (width - gap * (n - 1)) / n);
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      className={className}
      role="img"
      aria-label={ariaLabel ?? `${n}-week activity sparkline`}
    >
      {values.map((v, i) => {
        const positive = v > 0;
        const h = positive ? Math.max(1.5, (v / max) * height) : 1;
        return (
          <rect
            key={i}
            x={i * (barW + gap)}
            y={height - h}
            width={barW}
            height={h}
            rx={0.5}
            fill={color}
            fillOpacity={positive ? 0.85 : 0.2}
          />
        );
      })}
    </svg>
  );
}
