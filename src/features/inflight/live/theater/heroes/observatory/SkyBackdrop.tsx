// The still sky: the wash, the star field, the three orbits with their captions, the legend, and the
// shared gradients. No hooks, no handlers — so NO "use client" (it travels with the client hero).
//
// NOTHING HERE MOVES. The stars are placed by a fixed seed and never twinkle: ambient motion may imply
// presence, never progress (`motion/taste-budgets`), and on this screen every movement must mean a
// real event. The orbit captions and the legend use the cockpit observatory's kicker voice verbatim
// (mono / uppercase / 0.22em / slate-500), so the two skies read as one instrument.

import type { ReactNode } from "react";
import type { SkyFrame } from "./skyEllipse";
import { GLOW_TONES, TONE_COLOR } from "./skyPalette";

const KICKER = "font-mono type-label uppercase tracking-[0.22em] fill-slate-500";
const STAR_COUNT = 150;

/** A tiny seeded PRNG (mulberry32) — the same sky on every screen, server and client alike. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const STARS = (() => {
  const rnd = seeded(20260918);
  return Array.from({ length: STAR_COUNT }, () => {
    const bright = rnd() > 0.94;
    return { x: rnd(), y: rnd(), r: bright ? 1.3 + rnd() * 0.6 : 0.5 + rnd() * 0.7, o: bright ? 0.4 + rnd() * 0.2 : 0.08 + rnd() * 0.22, blue: rnd() > 0.7 };
  });
})();

export const RING_CAPTION = ["At work", "Next up", "Resting"] as const;

export function SkyDefs({ idp }: { idp: string }) {
  return (
    <defs>
      <radialGradient id={`${idp}-wash`} cx="50%" cy="46%" r="60%">
        <stop offset="0%" stopColor="var(--color-accent)" stopOpacity="0.09" />
        <stop offset="55%" stopColor="var(--color-accent)" stopOpacity="0.025" />
        <stop offset="100%" stopColor="var(--color-accent)" stopOpacity="0" />
      </radialGradient>
      {GLOW_TONES.map((t) => (
        <radialGradient key={t} id={`${idp}-glow-${t}`} className={TONE_COLOR[t]}>
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.55" />
          <stop offset="35%" stopColor="currentColor" stopOpacity="0.16" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
        </radialGradient>
      ))}
    </defs>
  );
}

export function SkyBackdrop({ f, idp, holding }: { f: SkyFrame; idp: string; holding: boolean }) {
  return (
    <g pointerEvents="none">
      <rect x={0} y={0} width={f.w} height={f.skyH} fill={`url(#${idp}-wash)`} />
      {STARS.map((s, i) => (
        <circle key={i} cx={s.x * f.w} cy={s.y * f.skyH} r={s.r} className={s.blue ? "fill-accent-soft" : "fill-slate-300"} opacity={s.o} />
      ))}
      <g opacity={holding ? 0.55 : 1}>
        {([0, 1, 2] as const).map((ring) => (
          <g key={ring}>
            <ellipse
              cx={f.cx}
              cy={f.cy}
              rx={f.rx[ring]}
              ry={f.ry[ring]}
              fill="none"
              className={ring === 0 ? "stroke-accent" : "stroke-slate-500"}
              strokeOpacity={ring === 0 ? 0.3 : ring === 1 ? 0.42 : 0.32}
              strokeWidth={ring === 0 ? 1.2 : 1}
              strokeDasharray={ring === 0 ? undefined : ring === 1 ? "2 7" : "1 10"}
            />
            <text x={f.cx} y={f.cy - f.ry[ring] - 9} textAnchor="middle" className={KICKER} opacity={ring === 0 ? 0.9 : 0.7}>
              {RING_CAPTION[ring]}
            </text>
          </g>
        ))}
      </g>
      <line x1={48} x2={f.w - 48} y1={f.skyH + 8} y2={f.skyH + 8} className="stroke-divider" strokeWidth={1} />
    </g>
  );
}

/**
 * The honest small print: what a tail and a halo are, and where the tail's memory begins.
 *
 * EVERY LINE DECODES SOMETHING THAT IS ON SCREEN. A key for a mark nobody can see is noise that
 * costs a passive viewer a read at 3 m and buys nothing, so the provenance line and the particle
 * colours appear only when a comet is actually drawn, and the halo ring only when a body wears one;
 * "seats carry no score" always stays, because the one thing this sky could be MISread as (a chart
 * with meaning in its angles) is present whenever a body is. The lines then stack from the top, so
 * dropping one leaves no hole. The keep-out `legendBox()` reserves stays at its widest either way —
 * a legend that shrank the keep-out would nudge outer bodies every time a comet appeared.
 */
export function SkyLegend({ opened, tails, halos }: { opened: string | null; tails: boolean; halos: boolean }) {
  const quiet = "font-mono type-micro uppercase tracking-[0.22em] fill-slate-500";
  const lines: ReactNode[] = [];
  if (tails) lines.push(<>Tails · activity seen since this screen opened{opened ? ` at ${opened}` : ""}</>);
  lines.push(
    <>
      {tails ? (
        <>
          <tspan className="fill-amber-300">●</tspan> edits <tspan dx={8} className="fill-accent-soft">●</tspan> reads{" "}
        </>
      ) : null}
      {halos ? (
        <>
          <tspan dx={tails ? 8 : 0} className="fill-success-soft">◯</tspan> landed today{" "}
        </>
      ) : null}
      <tspan dx={tails || halos ? 8 : 0}>{tails || halos ? "· seats carry no score" : "Seats carry no score"}</tspan>
    </>,
  );
  return (
    <g pointerEvents="none" opacity={0.85} data-legend={tails ? "tails" : halos ? "halos" : "bare"}>
      {lines.map((line, i) => (
        <text key={i} x={24} y={24 + i * 20} className={quiet}>
          {line}
        </text>
      ))}
    </g>
  );
}
