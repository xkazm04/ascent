"use client";

// The one large shared radar for the tech-stacks "Profiles" view — every ACTIVE stack overlaid on a
// single 9-axis field (color = which stack, radius = that dimension's score). framer-motion draws
// each profile on when it's toggled in and fades it out when toggled off; hovering a stack in the
// rail (`emphasisId`) raises that profile and recedes the rest, so overlapping shapes stay readable.
// All motion is gated by useReducedMotion.
//
// A series value of `null` is a dimension the stack carries NO average for, and it is drawn as the
// §2.4 `missing` state: no vertex, no dot, the ring simply broken (radarShape). It used to arrive
// here as `?? 0` and plot at the centre — a stack whose scans predate a dimension read as scoring
// zero on it. A profile with any hole is never filled: the enclosed area would be invented.

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { DIMENSION_SHORT } from "@/lib/ui";
import { fmtNum } from "@/components/org/viz";
import { axisAngle, polarPoint, labelAnchor, radarShape } from "@/features/standing/tech-stacks/stackViz";
import { RadarSrTable } from "@/features/standing/tech-stacks/RadarSrTable";

const dimShort = (id: string) => DIMENSION_SHORT[id as keyof typeof DIMENSION_SHORT] ?? id;

const CX = 130;
const CY = 130;
const R = 96;
const LABEL_R = 116;
const RINGS = [0.25, 0.5, 0.75, 1];

export interface RadarSeries {
  id: string;
  name: string;
  color: string;
  /** Per-dimension score (0..100) aligned to `dims`; `null` = no measurement, never a zero. */
  values: (number | null)[];
}

/** "D2, D7" — the dimensions this stack was never scored on, for the profile's own <title>. */
function voidNote(dims: string[], voidAxes: number[]): string {
  if (voidAxes.length === 0) return "";
  return ` · no measurement on ${voidAxes.map((i) => dimShort(dims[i] ?? "")).join(", ")}`;
}

export function StackRadarChart({
  series,
  dims,
  emphasisId,
}: {
  series: RadarSeries[];
  dims: string[];
  /** When set, this series is raised and the others recede (rail hover/focus). */
  emphasisId?: string | null;
}) {
  const rm = useReducedMotion();
  return (
    <>
      <svg
        viewBox="0 0 260 260"
        className="h-full w-full overflow-visible"
        role="img"
        aria-label={`Maturity profiles across ${dims.length} dimensions for ${series.map((s) => s.name).join(", ") || "no selected stacks"}`}
      >
        {/* concentric grid rings + their scale ticks */}
        {RINGS.map((f) => (
          <circle key={f} cx={CX} cy={CY} r={R * f} fill="none" className="stroke-divider" strokeWidth={0.6} />
        ))}
        {RINGS.map((f) => (
          <text key={`t-${f}`} x={CX + 2} y={CY - R * f - 1} className="fill-slate-600 font-mono" fontSize={6}>
            {f * 100}
          </text>
        ))}

        {/* spokes + perimeter dimension labels */}
        {dims.map((d, i) => {
          const ang = axisAngle(i, dims.length);
          const end = polarPoint(CX, CY, R, ang);
          const lab = polarPoint(CX, CY, LABEL_R, ang);
          return (
            <g key={d}>
              <line x1={CX} y1={CY} x2={end.x} y2={end.y} className="stroke-divider" strokeWidth={0.6} />
              <text
                x={lab.x}
                y={lab.y}
                textAnchor={labelAnchor(ang)}
                dominantBaseline="middle"
                className="fill-slate-300 font-mono"
                fontSize={9}
              >
                {dimShort(d)}
              </text>
            </g>
          );
        })}

        {/* each active stack's profile, in its identity color */}
        <AnimatePresence>
          {series.map((s) => {
            const emphasized = emphasisId != null && emphasisId === s.id;
            const receded = emphasisId != null && emphasisId !== s.id;
            // Fills thin out as more profiles overlay so the center never muddies — strokes carry
            // identity past ~3 stacks. A hovered profile fills solid; the receded ones nearly clear.
            const n = series.length;
            const baseFill = n === 1 ? 0.16 : n <= 3 ? 0.08 : 0.035;
            const shape = radarShape(CX, CY, R, s.values.map((v) => (v == null ? null : v / 100)));
            // A broken ring encloses nothing real, so only a complete profile is filled.
            const fill = !shape.complete ? 0 : emphasized ? 0.18 : receded ? 0.02 : baseFill;
            const title = `${s.name}${voidNote(dims, shape.voidAxes)}`;
            return (
              <motion.g
                key={s.id}
                initial={rm ? false : { opacity: 0 }}
                animate={{ opacity: receded ? 0.28 : 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: rm ? 0 : 0.35 }}
              >
                <title>{title}</title>
                {shape.paths.map((d, i) => (
                  <motion.path
                    key={i}
                    d={d}
                    fill={shape.complete ? s.color : "none"}
                    fillOpacity={fill}
                    stroke={s.color}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    initial={rm ? false : { pathLength: 0 }}
                    animate={{ pathLength: 1, strokeWidth: emphasized ? 2.75 : 2 }}
                    transition={{ duration: rm ? 0 : 0.6, ease: "easeOut" }}
                  />
                ))}
                {s.values.map((v, i) =>
                  v == null ? null : (
                    <circle
                      key={i}
                      cx={polarPoint(CX, CY, R * (v / 100), axisAngle(i, dims.length)).x}
                      cy={polarPoint(CX, CY, R * (v / 100), axisAngle(i, dims.length)).y}
                      r={emphasized ? 2.8 : 2.2}
                      fill={s.color}
                      stroke="var(--color-ink)"
                      strokeWidth={0.6}
                    >
                      <title>{`${s.name} · ${dimShort(dims[i]!)}: ${fmtNum(v, 0)}`}</title>
                    </circle>
                  ),
                )}
              </motion.g>
            );
          })}
        </AnimatePresence>
      </svg>
      <RadarSrTable series={series} dims={dims} />
    </>
  );
}
