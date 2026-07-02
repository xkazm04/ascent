"use client";

import { useEffect, useRef, useState } from "react";
import { scoreGlyph, scoreHex } from "@/lib/ui";
import { POSTURE_HEX } from "@/components/org/liveWarRoomShared";

/** Tween an integer toward `target` with an ease-out cubic, honoring prefers-reduced-motion. */
function useTween(target: number, ms = 650): number {
  const [val, setVal] = useState(target);
  // Holds the last displayed value so a new target animates from where the number actually is.
  // Only ever read/written inside the effect below (never during render).
  const valRef = useRef(target);
  useEffect(() => {
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const from = valRef.current;
    if (reduced || from === target) {
      valRef.current = target;
      setVal(target);
      return;
    }
    let raf = 0;
    let start = 0;
    const step = (t: number) => {
      if (!start) start = t;
      const p = Math.min(1, (t - start) / ms);
      const eased = 1 - Math.pow(1 - p, 3);
      const v = Math.round(from + (target - from) * eased);
      valRef.current = v;
      setVal(v);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return val;
}

/** Signed campaign movement beside a headline value — direction-colored, period named for SRs. */
function DeltaChip({ delta }: { delta: number }) {
  const color = delta > 0 ? "text-emerald-300" : delta < 0 ? "text-orange-300" : "text-slate-500";
  return (
    <span className="font-mono text-sm text-slate-500">
      <span className={color}>
        <span aria-hidden>{delta > 0 ? "▲" : delta < 0 ? "▼" : "＝"}</span> {delta > 0 ? "+" : ""}
        {delta}
      </span>{" "}
      since kickoff
    </span>
  );
}

/** Tiny single-series trend line: de-emphasis stroke, current point in the accent with a surface
 *  ring. No legend (one series — the cell label names it); the aria-label carries the values. */
function Sparkline({ points }: { points: number[] }) {
  const W = 112;
  const H = 28;
  const P = 5; // padding so the 4px end-dot + its ring never clip
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min;
  const x = (i: number) => P + (i / (points.length - 1)) * (W - 2 * P);
  // Flat series: draw a midline rather than dividing by zero.
  const y = (v: number) => (span === 0 ? H / 2 : H - P - ((v - min) / span) * (H - 2 * P));
  const d = points.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  const first = points[0] ?? 0;
  const last = points[points.length - 1] ?? 0;
  return (
    <svg
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`Fleet average over the last ${points.length} scan days: ${first} to ${last}`}
      className="mt-1.5"
    >
      <path d={d} fill="none" stroke="#64748b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={x(points.length - 1)} cy={y(last)} r="4" fill="var(--color-accent)" stroke="#0b1322" strokeWidth="2" />
    </svg>
  );
}

function StatCell({
  label,
  value,
  color,
  delta,
  render,
  sub,
  className = "",
  children,
}: {
  label: string;
  value: number | null;
  color?: string;
  /** Campaign movement (null/undefined = no active goal → no chip). */
  delta?: number | null;
  render?: (n: number) => string;
  /** Muted context line under the value (e.g. "of 12 scored"). */
  sub?: string;
  className?: string;
  children?: React.ReactNode;
}) {
  const tweened = useTween(value ?? 0);
  const shown = value == null ? "—" : render ? render(tweened) : String(tweened);
  return (
    <div className={`p-4 lg:p-5 ${className}`}>
      <div className="font-mono text-sm uppercase tracking-widest text-slate-500">{label}</div>
      <div className="mt-1 flex items-baseline gap-2">
        {/* Non-color channel beside the score-colored numeral (the red→green ramp alone collapses under CVD). */}
        {value != null && !render && (
          <span className="font-mono text-base" style={{ color }} aria-hidden>
            {scoreGlyph(value)}
          </span>
        )}
        {/* tabular-nums is deliberate: the value tweens every landed result, and proportional digits
            would make the strip's layout jitter frame-by-frame on a projected wall. */}
        <span className="font-mono text-3xl font-bold tabular-nums sm:text-4xl" style={{ color: value == null ? "#fff" : color ?? "#fff" }}>
          {shown}
        </span>
        {value != null && delta != null && <DeltaChip delta={delta} />}
      </div>
      {sub && <div className="mt-1 font-mono text-sm text-slate-500">{sub}</div>}
      {children}
    </div>
  );
}

/**
 * The wall's headline metrics as ONE command strip (2×2 on mobile, a divided 1×4 band on lg) instead
 * of four floating cards — less chrome, less scroll, reads as a single instrument. Each metric keeps
 * the count-up tween; the campaign deltas and the trend spark give the numbers a direction, not just
 * a level.
 */
export function HeadlineStrip({
  stats,
  deltas = null,
  trend,
}: {
  stats: {
    avgOverall: number | null;
    avgAdoption: number | null;
    avgRigor: number | null;
    aiNative: number;
    scored: number;
    total: number;
  };
  deltas?: { overall: number; adoption: number; rigor: number } | null;
  trend?: { date: string; avg: number }[];
}) {
  const spark = (trend ?? []).slice(-12).map((t) => t.avg);
  return (
    <section
      aria-label="Fleet headline metrics"
      className="mt-6 grid grid-cols-2 overflow-hidden rounded-2xl border border-slate-800 bg-slate-900/40 lg:grid-cols-4"
    >
      <StatCell
        label="Org maturity"
        value={stats.avgOverall}
        color={stats.avgOverall == null ? undefined : scoreHex(stats.avgOverall)}
        delta={deltas?.overall}
      >
        {spark.length >= 2 && <Sparkline points={spark} />}
      </StatCell>
      <StatCell
        label="AI Adoption"
        value={stats.avgAdoption}
        color={stats.avgAdoption == null ? undefined : scoreHex(stats.avgAdoption)}
        delta={deltas?.adoption}
        className="border-l border-slate-800"
      />
      <StatCell
        label="Engineering Rigor"
        value={stats.avgRigor}
        color={stats.avgRigor == null ? undefined : scoreHex(stats.avgRigor)}
        delta={deltas?.rigor}
        className="border-t border-slate-800 lg:border-l lg:border-t-0"
      />
      <StatCell
        label="AI-Native repos"
        value={stats.aiNative}
        color={stats.aiNative > 0 ? POSTURE_HEX["ai-native"] : undefined}
        render={(n) => `${n}/${stats.scored || stats.total}`}
        sub={stats.scored > 0 ? `of ${stats.scored} scored` : undefined}
        className="border-l border-t border-slate-800 lg:border-t-0"
      />
    </section>
  );
}
