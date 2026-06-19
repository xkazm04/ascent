"use client";

// The flight-path chart (migrated from the Flight Deck prototype — the strongest levels chart). A
// Recharts line of the climb (level band-midpoint as altitude): angular path, ramp-gradient stroke,
// square waypoint markers, and a dashed AI-Native threshold line. Mounted-gated; animation off under
// reduced-motion.

import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { LEVELS, LEVEL_BY_ID, POSTURE_THRESHOLD } from "@/lib/maturity/model";
import { LEVEL_HEX } from "@/lib/ui";
import { RAMP_STOPS, bandMid } from "../shared/levelRamp";
import { usePrefersReducedMotion, useReplayOnView } from "@/components/report/chartMotion";
import type { LevelId } from "@/lib/types";

interface Pt {
  level: string;
  name: string;
  altitude: number;
  low: number;
  high: number;
  tagline: string;
}

const DATA: Pt[] = LEVELS.map((l) => ({
  level: l.id,
  name: l.name,
  altitude: bandMid(l.band),
  low: l.band[0],
  high: l.band[1],
  tagline: l.tagline,
}));

function Waypoint({ cx, cy, payload }: { cx?: number; cy?: number; payload?: Pt }) {
  if (cx == null || cy == null || !payload) return null;
  const color = LEVEL_HEX[payload.level as LevelId] ?? "#3b9eff";
  return (
    <g>
      <rect x={cx - 5} y={cy - 5} width={10} height={10} fill="#0b1322" stroke={color} strokeWidth={1.5} transform={`rotate(45 ${cx} ${cy})`} />
      <circle cx={cx} cy={cy} r={1.6} fill={color} />
    </g>
  );
}

function AxisTick({ x, y, payload }: { x?: number; y?: number; payload?: { value: string } }) {
  if (x == null || y == null || !payload) return null;
  const lvl = LEVEL_BY_ID[payload.value as LevelId];
  return (
    <g transform={`translate(${x},${y})`}>
      <text x={0} y={12} textAnchor="middle" fontSize={12} fontWeight={700} fill={LEVEL_HEX[payload.value as LevelId]} className="font-mono">
        {payload.value}
      </text>
      <text x={0} y={27} textAnchor="middle" fontSize={10} fill="#64748b" className="font-mono uppercase">
        {lvl?.name}
      </text>
    </g>
  );
}

function ChartTip({ active, payload }: { active?: boolean; payload?: Array<{ payload: Pt }> }) {
  if (!active || !payload?.length) return null;
  const p = payload[0]!.payload;
  return (
    <div className="rounded-md border border-accent/40 bg-ink/95 px-3 py-2 font-mono shadow-xl">
      <div className="flex items-center gap-2">
        <span className="text-sm font-bold" style={{ color: LEVEL_HEX[p.level as LevelId] }}>[{p.level}]</span>
        <span className="text-sm font-semibold text-white">{p.name}</span>
      </div>
      <div className="mt-0.5 text-xs text-slate-400">ALT {p.low}–{p.high} · band</div>
      <div className="mt-1 max-w-[15rem] font-sans text-sm text-slate-400">{p.tagline}</div>
    </div>
  );
}

export function TrajectoryChart() {
  const reduced = usePrefersReducedMotion();
  // Re-draw each time the chart scrolls into view (deck behaviour): the incrementing replayKey
  // remounts the LineChart so Recharts re-runs its enter animation. reduced-motion shows it at rest.
  const { ref, replayKey } = useReplayOnView<HTMLDivElement>();
  const show = reduced || replayKey > 0;

  return (
    <div ref={ref} className="h-[360px] w-full">
      {show ? (
        <ResponsiveContainer width="100%" height="100%">
          <LineChart key={reduced ? "static" : replayKey} data={DATA} margin={{ top: 24, right: 56, bottom: 18, left: 4 }}>
          <defs>
            <linearGradient id="index-trajectory-stroke" x1="0" y1="0" x2="1" y2="0">
              {RAMP_STOPS.map((s) => (
                <stop key={s.id} offset={`${Math.round(s.offset * 100)}%`} stopColor={s.color} />
              ))}
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#16233b" strokeDasharray="2 4" />
          <XAxis dataKey="level" tick={<AxisTick />} tickLine={false} axisLine={{ stroke: "#1e293b" }} interval={0} height={44} />
          <YAxis
            domain={[0, 100]}
            ticks={[0, 25, 50, 75, 100]}
            width={34}
            tickLine={false}
            axisLine={false}
            tick={{ fill: "#475569", fontSize: 11, fontFamily: "var(--font-mono)" }}
          />
          <ReferenceLine
            y={POSTURE_THRESHOLD}
            stroke="#3b9eff"
            strokeDasharray="5 4"
            strokeOpacity={0.6}
            label={{ value: "AI-NATIVE", position: "right", fill: "#7bbcff", fontSize: 10, fontFamily: "var(--font-mono)" }}
          />
          <Tooltip content={<ChartTip />} cursor={{ stroke: "#3b9eff", strokeDasharray: "3 3" }} />
          <Line
            type="linear"
            dataKey="altitude"
            stroke="url(#index-trajectory-stroke)"
            strokeWidth={2.5}
            dot={<Waypoint />}
            activeDot={{ r: 6 }}
            isAnimationActive={!reduced}
            animationDuration={1300}
            animationEasing="ease-out"
          />
          </LineChart>
        </ResponsiveContainer>
      ) : (
        <div className="h-full w-full animate-pulse rounded-xl bg-slate-900/40" />
      )}
    </div>
  );
}
