"use client";

import { useEffect, useRef, useState } from "react";
import { scoreGlyph, scoreHex } from "@/lib/ui";
import { POSTURE_HEX } from "@/components/org/shared/liveWarRoomShared";
import { HEADLINE_SCALE, type WallScale } from "@/components/org/live/warRoomScale";
import { headlineAnnouncement } from "@/components/org/live/warRoomAnnounce";

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

/**
 * The strip's settled voice. The tiles tween on EVERY landed result; announcing that would put a
 * second polite region in competition with the header's per-run progress count, so this speaks only
 * once the numbers have stopped moving AND no scan is in flight — i.e. once per run, plus once per
 * kiosk refresh that actually changed something. Seeded with the mount value so a page load is
 * silent: only real movement gets a voice.
 */
const SETTLE_MS = 1200;

function useSettledAnnouncement(text: string, running: boolean): string {
  const [msg, setMsg] = useState("");
  const saidRef = useRef(text);
  useEffect(() => {
    if (running || text === saidRef.current) return;
    const t = setTimeout(() => {
      saidRef.current = text;
      setMsg(text);
    }, SETTLE_MS);
    return () => clearTimeout(t);
  }, [text, running]);
  return msg;
}

/** Signed campaign movement beside a headline value — direction-colored, period named for SRs. */
function DeltaChip({ delta, size }: { delta: number; size: string }) {
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
function Sparkline({ points, box }: { points: number[]; box: { w: number; h: number } }) {
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
function StatCell({
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
  scale = "panel",
  running = false,
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
  /** "wall" = the surface has DECLARED itself a wall (TV mode / read-only share screen). See
   *  warRoomScale.ts for why this is a mode and not a breakpoint. */
  scale?: WallScale;
  /** A scan is in flight — suppresses this strip's announcer so the header's coalesced progress
   *  count stays the single live voice for the run. */
  running?: boolean;
}) {
  const spark = (trend ?? []).slice(-12).map((p) => p.avg);
  const sz = HEADLINE_SCALE[scale];
  const announcement = useSettledAnnouncement(headlineAnnouncement(stats, deltas), running);
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
        scale={scale}
      >
        {spark.length >= 2 && <Sparkline points={spark} box={sz.spark} />}
      </StatCell>
      <StatCell
        label="AI Adoption"
        value={stats.avgAdoption}
        color={stats.avgAdoption == null ? undefined : scoreHex(stats.avgAdoption)}
        delta={deltas?.adoption}
        scale={scale}
        className="border-l border-slate-800"
      />
      <StatCell
        label="Engineering Rigor"
        value={stats.avgRigor}
        color={stats.avgRigor == null ? undefined : scoreHex(stats.avgRigor)}
        delta={deltas?.rigor}
        scale={scale}
        className="border-t border-slate-800 lg:border-l lg:border-t-0"
      />
      {/* live-war-room 07-16 #4: the old `${n}/${stats.scored || stats.total}` silently swapped the
          denominator from "repos scored" to "whole fleet" when nothing was scanned yet — and hid the
          clarifying sub line in exactly that case, so "0/40" (fleet size) read like "0 of 40 scored"
          on a projected wall. Pre-scan the tile now shows an honest em-dash with a named empty state;
          the denominator is ALWAYS "repos scored" and its sub label always renders. */}
      <StatCell
        label="AI-Native repos"
        value={stats.aiNative}
        color={stats.aiNative > 0 ? POSTURE_HEX["ai-native"] : undefined}
        render={(n) => (stats.scored > 0 ? `${n}/${stats.scored}` : "—")}
        sub={stats.scored > 0 ? `of ${stats.scored} scored` : "no scans yet"}
        scale={scale}
        className="border-l border-t border-slate-800 lg:border-t-0"
      />
      {/* G6-07: the settled voice of the four tiles. Empty until the numbers actually move and the
          run finishes — see useSettledAnnouncement. */}
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>
    </section>
  );
}
