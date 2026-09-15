"use client";

// Parts of the war-room headline strip (LiveWarRoomStat.tsx): the delta chip, the trend sparkline and
// the tweened stat cell. Split out so the strip's own file stays under the 200-LOC cap
// (docs/ORG-TABS-REFACTOR.md).

import { scoreGlyph } from "@/lib/ui";
import { DIRECTION_TONE, deltaHex, signedDelta, toneFor } from "@/components/ui";
import { stateTitle } from "@/components/org/viz";
import { HEADLINE_SCALE, type WallScale } from "./warRoomScale";
import { useTween } from "./useLiveWarRoomStat";

/**
 * Signed campaign movement beside a headline value — direction-coloured, period named for SRs.
 *
 * Painted by the brand's ONE direction triad (DIRECTION_TONE/deltaHex), not by a local emerald/orange
 * copy of it. The copy this replaces was a second dialect in two ways: emerald rather than the fleet's
 * lime, and — the one that mattered — no noise band, so a +1 that is scan-to-scan wobble wore the same
 * confident ▲ as a +9 on the projected wall. `toneFor` mutes that case to the flat tone and its "→".
 * The arrow stays `aria-hidden` beside the signed number: SRs read "▲" inconsistently (the reason
 * warRoomAnnounce speaks in words), so the glyph is reinforcement, never the channel.
 */
export function DeltaChip({ delta, size }: { delta: number; size: string }) {
  return (
    <span className={`font-mono ${size} text-slate-500`}>
      <span style={{ color: deltaHex(delta) }}>
        <span aria-hidden>{DIRECTION_TONE[toneFor(delta)].arrow}</span> {signedDelta(delta)}
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
      className="mt-1.5 text-slate-500"
    >
      {/* No hand-picked hexes: the de-emphasis stroke rides `currentColor` off the muted text class
          above, and the end-dot's separating ring is the page ink token, not a near-match of it. */}
      <path d={d} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={x(points.length - 1)} cy={y(last)} r="4" fill="var(--color-accent)" stroke="var(--color-ink)" strokeWidth="2" />
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
            would make the strip's layout jitter frame-by-frame on a projected wall.
            An absent value keeps the em dash rather than the kit's void mark — this numeral is read
            from 4m and a 12px broken rule is not — but it carries the kit's caveat verbatim, so the
            "an em dash is a missing measurement, not a zero" sentence is disclosed rather than
            asserted, and the `sub` line names the empty state in visible text beneath it. */}
        <span
          className={`font-mono ${t.value} font-bold tabular-nums text-white`}
          style={color && value != null ? { color } : undefined}
          title={value == null ? stateTitle("missing", label) : undefined}
        >
          {shown}
        </span>
        {value != null && delta != null && <DeltaChip delta={delta} size={t.delta} />}
      </div>
      {sub && <div className={`mt-1 font-mono ${t.sub} text-slate-500`}>{sub}</div>}
      {children}
    </div>
  );
}
