"use client";

// Parts of the war-room headline strip (LiveWarRoomStat.tsx): the delta chip, the trend sparkline and
// the tweened stat cell. Split out so the strip's own file stays under the 200-LOC cap
// (docs/ORG-TABS-REFACTOR.md).

import { scoreGlyph } from "@/lib/ui";
import { HEADLINE_SCALE, type WallScale } from "./warRoomScale";
import { useTween } from "./useLiveWarRoomStat";

/** Signed campaign movement beside a headline value — direction-colored, period named for SRs. */
export function DeltaChip({ delta, size }: { delta: number; size: string }) {
  const color = delta > 0 ? "text-emerald-300" : delta < 0 ? "text-orange-300" : "text-slate-500";
  return (
    <span className={`font-mono ${size} text-slate-500`}>
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
export function Sparkline({ points, box }: { points: number[]; box: { w: number; h: number } }) {
  const W = box.w;
  const H = box.h;
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

/**
 * The war-room cell. Deliberately NOT the brand `ui/Stat`: it carries a two-mode type scale (panel
 * 3xl→4xl, wall 5xl→7xl, see warRoomScale.ts) against Stat's fixed 2xl, its value is a live tween
 * rather than a rendered figure, and the value row is a baseline flex
 * carrying a CVD-safe score glyph, a delta chip, and an arbitrary child (the sparkline). Folding those
 * into Stat would mean a size scale, a render override, a glyph slot and two extra child slots on a
 * primitive used by every dashboard tile — a kitchen sink to serve one wall display. Keep this local.
 */
export function StatCell({
  label,
  value,
  color,
  delta,
  render,
  sub,
  scale,
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
  scale: WallScale;
  className?: string;
  children?: React.ReactNode;
}) {
  const tweened = useTween(value ?? 0);
  const shown = value == null ? "—" : render ? render(tweened) : String(tweened);
  const t = HEADLINE_SCALE[scale];
  return (
    <div className={`${t.pad} ${className}`}>
      <div className={`font-mono ${t.label} uppercase tracking-widest text-slate-500`}>{label}</div>
      {/* flex-wrap so the wall tier's much larger numeral can push the delta chip onto its own line
          instead of overflowing the cell. */}
      <div className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-1">
        {/* Non-color channel beside the score-colored numeral (the red→green ramp alone collapses under CVD). */}
        {value != null && !render && (
          <span className={`font-mono ${t.glyph}`} style={{ color }} aria-hidden>
            {scoreGlyph(value)}
          </span>
        )}
        {/* tabular-nums is deliberate: the value tweens every landed result, and proportional digits
            would make the strip's layout jitter frame-by-frame on a projected wall. */}
        <span className={`font-mono ${t.value} font-bold tabular-nums`} style={{ color: value == null ? "#fff" : color ?? "#fff" }}>
          {shown}
        </span>
        {value != null && delta != null && <DeltaChip delta={delta} size={t.delta} />}
      </div>
      {sub && <div className={`mt-1 font-mono ${t.sub} text-slate-500`}>{sub}</div>}
      {children}
    </div>
  );
}
