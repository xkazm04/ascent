"use client";

// The motion showcase: an instrument panel that exercises every technique of the registry's `motion`
// subject as a region carrying `data-technique="<slug>"` (the frame spotlights the selected one).
// Reads `reduced` and `volume` from props — never its own media query — and mounts the scene's
// keyframes in one <style> so the presets in presets.ts resolve to real animations here without
// touching globals.css. framer-motion is used in EnginePanel only; it enters via the body map.

import { EngineRegion } from "./EnginePanel";
import { GestureRegion } from "./GesturePanel";
import { LoopRegions } from "./LoopPanel";
import { OneShotRegion } from "./OneShotPanel";
import { PerfRegion } from "./PerfPanel";
import { BudgetRegion, PresetRegion } from "./PresetPanel";
import { ContentRegion, ReducedRegion } from "./ReducedPanel";
import { SCENE_KEYFRAMES } from "./presets";
import type { SurfaceSceneProps } from "../surfaceBody";

export function Scene({ reduced, volume }: SurfaceSceneProps) {
  return (
    <div className="space-y-3" data-scene="motion" data-reduced={reduced}>
      <style>{SCENE_KEYFRAMES}</style>
      <div className="grid gap-3 lg:grid-cols-2">
        <PresetRegion reduced={reduced} />
        <BudgetRegion />
      </div>
      <GestureRegion reduced={reduced} />
      <EngineRegion reduced={reduced} />
      <div className="grid gap-3 lg:grid-cols-2">
        <PerfRegion reduced={reduced} />
        <OneShotRegion reduced={reduced} volume={volume} />
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <ReducedRegion reduced={reduced} />
        <ContentRegion reduced={reduced} />
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <LoopRegions reduced={reduced} />
      </div>
    </div>
  );
}
