"use client";

// The async-ui-states showcase: a fictional org page composed of independent async regions — a
// repository search (with the three instruments that read its machinery), a review queue, a
// follow-ups region that settles into typed empties, and an alerts region that can be made to fail.
// Every technique of the registry subject is a region carrying `data-technique="<slug>"`; the frame
// spotlights the selected one. `reduced` and `volume` come from props — never a media query here —
// and the scene's keyframes mount in one <style>. No framer-motion: CSS keyframes are enough.

import { useState } from "react";
import type { SurfaceSceneProps } from "../surfaceBody";
import { SCENE_KEYFRAMES, type Latency } from "./asyncState";
import { EmptyRegion } from "./EmptyPanel";
import { FailureRegion } from "./FailurePanel";
import { QueueRegion } from "./QueuePanel";
import { SearchRegions } from "./SearchRegions";

export function Scene({ reduced, volume }: SurfaceSceneProps) {
  // The network dial is scene-wide: every simulated request reads it (warm = inside the ghost window).
  const [latency, setLatency] = useState<Latency>("slow");
  return (
    <div className="space-y-3" data-scene="async-ui-states" data-reduced={reduced}>
      <style>{SCENE_KEYFRAMES}</style>
      <p className="type-caption text-slate-500">
        Fixture data: <span className="text-slate-300">{volume.toLocaleString()}</span> fictional repositories, seeded; every request is simulated at the dial’s latency. Nothing here is an Ascent org.
      </p>
      {/* Keyed on volume: a new universe is a new surface (its own first arrival), not a hand-reset. */}
      <SearchRegions key={volume} volume={volume} reduced={reduced} latency={latency} setLatency={setLatency} />
      <div className="grid gap-3 lg:grid-cols-3">
        <QueueRegion reduced={reduced} latency={latency} />
        <EmptyRegion reduced={reduced} latency={latency} />
        <FailureRegion reduced={reduced} latency={latency} />
      </div>
    </div>
  );
}
