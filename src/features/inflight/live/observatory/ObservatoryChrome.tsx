// Static chrome of the observatory field: the hairline frame, the axis scales, the AI-Native
// frontier and the quadrant captions. No hooks, no handlers — so NO "use client" directive (it is
// imported by a client component and travels with it).
//
// The quadrant captions are SVG <text> rather than the <Kicker> primitive because Kicker renders a
// div/span/legend and HTML flow content is not valid inside <svg>. The type treatment is copied from
// Kicker tone="muted" verbatim (font-mono / uppercase / tracking-[0.22em] / text-slate-500) so the
// two stay one voice.

import { FIELD, QUADRANT_LABEL, frontier, projectX, projectY, type QuadrantId } from "./observatoryModel";

const KICKER = "font-mono text-[10px] uppercase tracking-[0.22em] fill-slate-500";
const AXIS = "font-mono text-[10px] tabular-nums fill-slate-600";

const CORNERS: Record<QuadrantId, { x: number; y: number; anchor: "start" | "end" }> = {
  "rigor-heavy": { x: 4, y: 96, anchor: "start" },
  compounding: { x: 96, y: 96, anchor: "end" },
  laggards: { x: 4, y: 4, anchor: "start" },
  "adoption-heavy": { x: 96, y: 4, anchor: "end" },
};

export function ObservatoryChrome({ gradientId }: { gradientId: string }) {
  const f = frontier();
  const x0 = projectX(0);
  const x1 = projectX(100);
  const y0 = projectY(0);
  const y1 = projectY(100);
  return (
    <g pointerEvents="none">
      <defs>
        <radialGradient id={gradientId} cx="100%" cy="0%" r="85%">
          <stop offset="0%" stopColor="var(--color-accent)" stopOpacity="0.14" />
          <stop offset="100%" stopColor="var(--color-accent)" stopOpacity="0" />
        </radialGradient>
      </defs>
      {/* Soft wash behind the AI-Native corner — the field's gravity well. */}
      <rect
        x={projectX(f.threshold)}
        y={y1}
        width={x1 - projectX(f.threshold)}
        height={projectY(f.threshold) - y1}
        fill={`url(#${gradientId})`}
      />

      {/* Frame + the 50/50 grid the posture cut already defines. */}
      <rect x={x0} y={y1} width={x1 - x0} height={y0 - y1} fill="none" className="stroke-divider" strokeWidth={1} />
      {[25, 75].map((v) => (
        <g key={v}>
          <line x1={projectX(v)} y1={y1} x2={projectX(v)} y2={y0} className="stroke-divider" strokeWidth={0.5} strokeOpacity={0.6} />
          <line x1={x0} y1={projectY(v)} x2={x1} y2={projectY(v)} className="stroke-divider" strokeWidth={0.5} strokeOpacity={0.6} />
        </g>
      ))}

      {/* The frontier is the BOUNDARY OF THE AI-NATIVE QUADRANT, not a diagonal: postureFor needs
          BOTH axes >= 50, so it is an L at (50, 50). Two dashed accent runs, one per axis cut. */}
      {f.segments.map((s, i) => (
        <line
          key={i}
          x1={projectX(s.x1)}
          y1={projectY(s.y1)}
          x2={projectX(s.x2)}
          y2={projectY(s.y2)}
          className="stroke-accent"
          strokeWidth={1}
          strokeOpacity={0.55}
          strokeDasharray="6 5"
        />
      ))}
      <text x={projectX(f.threshold) + 8} y={projectY(100) + 14} className={KICKER} fill="var(--color-accent)" fillOpacity={0.8}>
        AI-Native frontier
      </text>

      {(Object.keys(CORNERS) as QuadrantId[]).map((q) => {
        const c = CORNERS[q];
        return (
          <text key={q} x={projectX(c.x)} y={projectY(c.y)} textAnchor={c.anchor} className={KICKER}>
            {QUADRANT_LABEL[q]}
          </text>
        );
      })}

      {/* Axis scales. */}
      {[0, 50, 100].map((v) => (
        <text key={`x${v}`} x={projectX(v)} y={y0 + 18} textAnchor="middle" className={AXIS}>
          {v}
        </text>
      ))}
      {[0, 50, 100].map((v) => (
        <text key={`y${v}`} x={x0 - 10} y={projectY(v) + 3} textAnchor="end" className={AXIS}>
          {v}
        </text>
      ))}
      <text x={projectX(50)} y={FIELD.h - 6} textAnchor="middle" className={KICKER}>
        Adoption
      </text>
      <text x={14} y={projectY(50)} textAnchor="middle" className={KICKER} transform={`rotate(-90 14 ${projectY(50)})`}>
        Rigor
      </text>
    </g>
  );
}
