"use client";

// THE OBSERVATORY THEATER — the runner as a night sky (spark theater-upgrade, WP8 prototype round).
//
// Continuity with the cockpit's Observatory: the same dark field, the same kicker voice, the same
// drift arc when a body moves and the same `burst-ring` when something lands. What differs is what
// SPACE means. The cockpit plots adoption × rigor, which the pulse does not carry; so this sky is an
// orrery whose only spatial meaning is the ring — at work (inner), next up, resting (outer) — around
// the runner's core. A lane at work is a comet: its tail is the activity this screen has seen (warm
// edits, cool reads, each particle cooling with age), its label says the phase and the file in type
// readable across the room, and a narrated line under the sky tells the whole moment in one sentence.
//
// Everything that moves is a real event (skyConstants.ts lists them); a stale pulse freezes `now`, so
// the cooling stops and nothing new can arrive; reduced motion renders every end state.

import { useId, useMemo } from "react";
import type { TheaterHeroProps } from "../theaterHeroSlot";
import { fmtClock } from "../theaterFormat";
import { skyFrame, pointOn } from "./observatory/skyEllipse";
import { landedWithin } from "./observatory/skyMemory";
import { skyModel } from "./observatory/skyModel";
import { layoutSky } from "./observatory/skyLayout";
import { cometTail, fade, tailRoom } from "./observatory/skyTail";
import { laneQuietForMs } from "@/lib/local/lane-phase";
import { fitNarration } from "./observatory/skyNarration";
import { JUST_LANDED_MS } from "./observatory/skyConstants";
import { useSkyDrift, useSkyMemory, useSkySize } from "./observatory/useSky";
import { SkyBackdrop, SkyDefs, SkyLegend } from "./observatory/SkyBackdrop";
import { SkyBodyMark, SkyComet, SkyCore } from "./observatory/SkyBodies";
import { CoreLabel, SkyLabels } from "./observatory/SkyLabels";
import { SkyNarrationLine, SkyTextAlternative } from "./observatory/SkyStory";

export function ObservatoryHero({ pulse, now, reducedMotion }: TheaterHeroProps) {
  const idp = `sky${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const [measure, size] = useSkySize();
  const mem = useSkyMemory(pulse, now);
  const f = useMemo(() => skyFrame(size), [size]);
  const model = useMemo(() => skyModel(pulse, mem, now), [pulse, mem, now]);
  const layout = useMemo(() => layoutSky(f, model), [f, model]);
  const drift = useSkyDrift(layout.seats, f, reducedMotion);

  const atWork = model.bodies.filter((b) => b.ring === 0);
  const degs = atWork.map((b) => layout.seats.get(b.repo)!.deg);
  const tails = new Map(
    atWork.map((b, i) => {
      const deg = degs[i]!;
      const room = tailRoom(f, deg, degs.filter((_, j) => j !== i));
      return [b.repo, cometTail(f, deg, room, b.memory?.events ?? [], b.tone, now)] as const;
    }),
  );
  const justLanded = model.bodies.filter((b) => landedWithin(mem, b.repo, now, JUST_LANDED_MS)).map((b) => b.name);
  const narration = fitNarration(model, now, justLanded, f.w - 120);
  const core = { x: f.cx, y: f.cy };
  // The nucleus burns as bright as the lane's newest evidence of life (tail, heartbeat, phase change):
  // a lane gone quiet dims with its silence, exactly as its phase word decays to "Still working".
  const life = (lane: (typeof model.bodies)[number]["lane"]) => (lane ? fade(laneQuietForMs(lane, now) ?? 0) : 0);
  const opened = fmtClock(new Date(mem.openedAt).toISOString());
  // Paint order: outer rings behind, then the comets, then the at-work nuclei, then all words on top.
  // Placement is resolved BEFORE the markup so the legend can be told what is actually drawn: a lane
  // can be at work and have no comet at all (a fresh planning lane has touched nothing yet, and a body
  // mid-glide drops its tail rather than drag it across the sky), and a legend line for a mark nobody
  // can see is noise. `heat` still reads the raw tail — a hidden tail's newest event is evidence of
  // life even in the frame where it is not drawn.
  const painted = [...model.bodies]
    .sort((a, b) => b.ring - a.ring)
    .map((b) => {
      const seat = layout.seats.get(b.repo)!;
      const at = drift.at(b.repo, seat);
      const settled = pointOn(f, seat.ring, seat.deg);
      const tail = tails.get(b.repo) ?? null;
      const gliding = at.x !== settled.x || at.y !== settled.y;
      return { b, at, heat: Math.max(tail?.heat ?? 0, life(b.lane)), comet: tail && !gliding && tail.shown > 0 ? tail : null };
    });
  const anyComet = painted.some((p) => p.comet !== null);
  const anyHalo = model.bodies.some((b) => b.halo > 0);

  return (
    <section
      ref={measure}
      aria-label="Observatory: each repo in the runner's scope as a body in a night sky — at work near the centre, next up on the middle ring, resting on the outer ring"
      data-hero-slot="observatory"
      className="relative min-h-[28rem] flex-1 overflow-hidden"
    >
      <svg viewBox={`0 0 ${f.w} ${f.h}`} preserveAspectRatio="xMidYMid meet" aria-hidden data-testid="observatory-sky" className="absolute inset-0 h-full w-full select-none">
        <SkyDefs idp={idp} />
        <SkyBackdrop f={f} idp={idp} holding={model.holding} />
        <SkyCore at={core} tone={model.core.tone} idp={idp} />
        {painted.map(({ b, at, heat, comet }) => (
          <g key={b.repo}>
            {comet ? <SkyComet tail={comet} reduced={reducedMotion} repo={b.repo} /> : null}
            <SkyBodyMark body={b} at={at} idp={idp} heat={heat} reduced={reducedMotion} holding={model.holding} />
          </g>
        ))}
        <SkyLabels model={model} labels={layout.labels} reduced={reducedMotion} />
        <CoreLabel f={f} core={model.core} at={core} />
        <SkyLegend opened={opened} tails={anyComet} halos={anyHalo} />
        <SkyNarrationLine f={f} narration={narration} />
      </svg>
      <SkyTextAlternative model={model} narration={narration} />
    </section>
  );
}
