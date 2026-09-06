"use client";

// The data-viz showcase: a fleet instrument board — one fictional fleet's scan metrics on the surfaces
// a product draws them on (a headline tile, small multiples, a sparkline column, a multi-series
// chart, a lazily-engined dashboard row, and one slot that walks every empty and degraded state).
// Every technique of the registry's `data-viz` subject is a region carrying `data-technique="<slug>"`
// (the frame spotlights the selected one). `reduced` and `volume` come from props — never a media
// query; the fixtures are seeded fiction and say so below. framer-motion is used in MiniLine only.

import { useMemo } from "react";
import type { SurfaceSceneProps } from "../surfaceBody";
import { EncodingRegion } from "./EncodingRegion";
import { LoadingRegion } from "./LoadingRegion";
import { MetricRegion } from "./MetricRegion";
import { MicroRegion } from "./MicroRegion";
import { ScaleRegion } from "./ScaleRegion";
import { StatesRegion } from "./StatesRegion";
import { BUCKETS, WINDOW, reposFor, totalsFor } from "./fixtures";

/** The placeholder's quiet arrival — delayed so a warm path never paints it. Scoped to the scene. */
const SCENE_KEYFRAMES = `
@keyframes surface-quiet { from { opacity: 0; } to { opacity: 1; } }
`;

export function Scene({ reduced, volume }: SurfaceSceneProps) {
  const repos = useMemo(() => reposFor(volume), [volume]);
  const totals = useMemo(() => totalsFor(volume), [volume]);

  return (
    <div className="space-y-3" data-scene="data-viz" data-reduced={reduced}>
      <style>{SCENE_KEYFRAMES}</style>
      <p className="type-caption text-slate-500">
        Fixture data: <span className="text-slate-300">{volume.toLocaleString()}</span> fictional repositories, {BUCKETS - 1} complete days + today so far, seeded — a window of {WINDOW} is
        drawn. Nothing here is an Ascent org.
      </p>
      <MetricRegion totals={totals} reduced={reduced} />
      <ScaleRegion repos={repos} reduced={reduced} />
      <div className="grid gap-3 lg:grid-cols-2">
        <MicroRegion repos={repos} volume={volume} reduced={reduced} />
        <EncodingRegion repos={repos} reduced={reduced} />
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <LoadingRegion repos={repos} reduced={reduced} />
        <StatesRegion repos={repos} reduced={reduced} />
      </div>
    </div>
  );
}
