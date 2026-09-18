// The things in the sky: the runner's core, each repo's body (with its "landed today" halo and the
// one-shot flare), and an at-work lane's comet tail. No hooks — no "use client".
//
// Every moving part is keyed to a real event and budgeted in skyConstants.ts:
//   - a particle ENTERS (scale + fade, `starting:` styles) only when `fresh` — it arrived after this
//     screen's first pulse; the baseline appears settled;
//   - particles SHIFT back one slot (a CSS transition on `translate`) when a new event joins the head;
//   - brightness eases between clock ticks (`FADE_TICK_MS`), so cooling is continuous — and stops dead
//     when the clock is frozen on a stale pulse, because then nothing changes;
//   - the flare is the cockpit's `burst-ring` language, mounted for `FLARE_HOLD_MS` under a key that is
//     the landing's identity, so it plays once; globals.css hides it under reduced motion, where the
//     halo (its end state) remains.

import type { CSSProperties } from "react";
import type { Pt } from "./skyEllipse";
import type { CoreTone, SkyBody } from "./skyModel";
import type { CometTail } from "./skyTail";
import { GLOW_R, HALO_GROWTH, NUCLEUS_R, PARTICLE_ENTER_MS, PARTICLE_SHIFT_MS, FADE_TICK_MS, RESTING_R, WAITING_R } from "./skyConstants";
import { PARTICLE_FILL, TONE_FILL, glowTone } from "./skyPalette";

const FILL_BOX: CSSProperties = { transformBox: "fill-box", transformOrigin: "center" };

export function SkyCore({ at, tone, idp }: { at: Pt; tone: CoreTone; idp: string }) {
  return (
    <g transform={`translate(${at.x} ${at.y})`} data-core={tone}>
      {tone === "live" ? <circle r={44} fill={`url(#${idp}-glow-plan)`} /> : null}
      {tone === "rest" ? <circle r={30} fill={`url(#${idp}-glow-quiet)`} /> : null}
      {tone === "hold" ? <circle r={10} fill="none" className="stroke-amber-300" strokeWidth={1.6} /> : null}
      {tone === "none" || tone === "stopped" ? (
        <circle r={8} fill="none" className="stroke-slate-600" strokeWidth={1.2} strokeDasharray="2 3" />
      ) : (
        <circle r={tone === "live" ? 6 : 4.5} className={tone === "live" ? "fill-accent" : tone === "hold" ? "fill-amber-300" : "fill-slate-400"} opacity={tone === "live" ? 1 : 0.7} />
      )}
    </g>
  );
}

function bodyRadius(b: SkyBody): number {
  const base = b.ring === 0 ? NUCLEUS_R : b.ring === 1 ? WAITING_R : RESTING_R;
  return base * (1 + HALO_GROWTH * b.halo);
}

export function SkyBodyMark({ body, at, idp, heat, reduced, holding }: { body: SkyBody; at: Pt; idp: string; heat: number; reduced: boolean; holding: boolean }) {
  const r = bodyRadius(body);
  const dim = holding || body.ring === 2 ? 0.55 : body.ring === 1 ? 0.85 : 1;
  const ease = (opacity: number): CSSProperties => ({ opacity, transition: reduced ? undefined : `opacity ${FADE_TICK_MS}ms linear, r 600ms ease-out` });
  return (
    <g transform={`translate(${at.x} ${at.y})`} data-body={body.repo} data-ring={body.ring} data-tone={body.tone} opacity={dim}>
      {Array.from({ length: body.halo }, (_, i) => (
        <circle
          key={i}
          data-halo={i + 1}
          r={r + 7 + i * 6}
          fill="none"
          className={`stroke-success-soft ${reduced ? "" : "transition-opacity duration-700 starting:opacity-0"}`}
          strokeWidth={1.3}
          strokeOpacity={0.62 - i * 0.16}
        />
      ))}
      {body.flareKey && !reduced ? (
        <g key={body.flareKey} data-flare={body.flareKey}>
          <circle r={20} className="burst-ring fill-success-soft" style={FILL_BOX} />
          <circle r={30} fill="none" className="burst-ring stroke-success-soft" strokeWidth={2.5} style={FILL_BOX} />
          <circle r={30} fill="none" className="burst-ring stroke-success-soft" strokeWidth={1.4} style={{ ...FILL_BOX, animationDelay: "220ms" }} />
        </g>
      ) : null}
      {body.ring === 0 ? (
        <circle r={GLOW_R} fill={`url(#${idp}-glow-${glowTone(body.tone)})`} style={ease(0.35 + 0.65 * heat)} />
      ) : null}
      <circle r={r} className={TONE_FILL[body.tone]} style={ease(body.ring === 0 ? 0.55 + 0.45 * Math.max(heat, 0.4) : 0.9)} />
      {body.ring === 0 ? <circle r={r * 0.45} className="fill-white" style={ease(0.35 + 0.5 * heat)} /> : null}
    </g>
  );
}

export function SkyComet({ tail, reduced, repo }: { tail: CometTail; reduced: boolean; repo: string }) {
  const tone = TONE_FILL[tail.tone];
  const shiftStyle = (p: { x: number; y: number; glow: number }): CSSProperties => ({
    translate: `${p.x}px ${p.y}px`,
    opacity: p.glow,
    transition: reduced ? undefined : `translate ${PARTICLE_SHIFT_MS}ms cubic-bezier(0.22, 1, 0.36, 1), opacity ${FADE_TICK_MS}ms linear`,
  });
  const enter = `transition-[scale,opacity] ease-out starting:scale-0 starting:opacity-0`;
  return (
    <g data-comet={repo} pointerEvents="none">
      {tail.ribbon.map((seg, i) => (
        <polygon key={i} points={seg.points} className={tone} style={{ opacity: seg.opacity, transition: reduced ? undefined : `opacity ${FADE_TICK_MS}ms linear` }} />
      ))}
      {/* Oldest first, so the newest particle paints on top at the head. */}
      {[...tail.particles].reverse().map((p) => (
        <g key={p.key} style={shiftStyle(p)} data-particle={p.kind}>
          <circle
            r={p.r}
            className={`${PARTICLE_FILL[p.kind]} ${p.fresh && !reduced ? enter : ""}`}
            style={p.fresh && !reduced ? { ...FILL_BOX, transitionDuration: `${PARTICLE_ENTER_MS}ms` } : undefined}
          />
        </g>
      ))}
    </g>
  );
}
