"use client";

// VARIANT — CONSOLE. Metaphor: an instrument console. Three rows, one channel at a time.
//
//   row 1  masthead + a segmented channel strip (the techniques)
//   row 2  the canvas, showing ONLY the selected technique's region, full width
//   row 3  the readout band: what the mechanism is (left) beside the code that does it (right)
//
// Why it differs from the baseline: the baseline is three COLUMNS with every region stacked in the
// middle one — a ten-region scene is a very tall page and the 20rem drawer wraps every line of
// source. Console spends the width instead of the height: the scene gets the full column, and the
// source gets a band wide enough to read a line of code without wrapping.
//
// The scene stays mounted while you switch channels (applySoloRegion hides, never unmounts), so an
// instrument that has been running keeps its state when you come back to it.

import { useEffect, useRef, useState } from "react";
import { Kicker, Surface } from "@/components/ui";
import type { SurfaceRecord } from "@/lib/org/surface-catalog";
import type { ReactNode } from "react";
import type { LoadedScene } from "./surfaceBody";
import { SurfaceControls } from "./SurfaceControls";
import type { FreshnessLabel } from "./SurfaceFreshnessBadge";
import { SurfaceHeader } from "./SurfaceHeader";
import { DeviationBlock, InAscentBlock, MechanismBlock, SourceBlock, TechniqueIdentity } from "./SurfaceMechanismParts";
import { SurfaceTechniqueStrip } from "./SurfaceTechniqueStrip";
import { applySoloRegion } from "./surfaceSpotlight";
import type { SurfaceSelectionApi } from "./useSurfaceSelection";

export function SurfaceFrameConsole({
  record,
  freshness,
  sel,
  osReduced,
  loaded,
  canvasFallback,
}: {
  record: SurfaceRecord;
  freshness: FreshnessLabel | null;
  sel: SurfaceSelectionApi;
  osReduced: boolean;
  loaded: LoadedScene | null;
  canvasFallback: ReactNode;
}) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const [showAll, setShowAll] = useState(false);
  const reduced = osReduced || sel.simulateReduced;
  const techniques = loaded?.body.techniques ?? [];
  // The resting state is ONE region: with no `?technique=` in the URL the first channel is live.
  const active = showAll ? null : sel.technique ?? techniques[0]?.slug ?? null;
  const index = techniques.findIndex((t) => t.slug === active);
  const selected = index >= 0 ? techniques[index] : undefined;
  const panelId = `surface-canvas-${record.slug}`;

  useEffect(() => {
    const root = canvasRef.current;
    if (root) applySoloRegion(root, active);
  });

  const pick = (slug: string) => {
    setShowAll(false);
    sel.setTechnique(slug);
  };

  return (
    <div className="space-y-4" data-surface-frame={record.slug} data-surface-variant="console">
      <SurfaceHeader
        record={record}
        freshness={freshness}
        right={
          <SurfaceControls
            volume={sel.volume}
            onVolume={sel.setVolume}
            simulateReduced={sel.simulateReduced}
            onSimulateReduced={sel.setSimulateReduced}
            osReduced={osReduced}
            galleryHref={sel.galleryHref}
          />
        }
      />

      <SurfaceTechniqueStrip techniques={techniques} active={active} panelId={panelId} onPick={pick} onAll={() => setShowAll(true)} />

      <Surface
        tone="strong"
        className="min-h-[18rem] p-5"
        data-surface-canvas={record.slug}
        id={panelId}
        role="tabpanel"
        aria-label={selected ? selected.title : "The whole composed scene"}
      >
        <div ref={canvasRef} className="min-h-full">
          {loaded ? (
            <loaded.Scope reduced={reduced}>
              <loaded.body.Scene technique={active} reduced={reduced} volume={sel.volume} />
            </loaded.Scope>
          ) : (
            canvasFallback
          )}
        </div>
      </Surface>

      {selected ? (
        <Surface radius="xl" className="grid gap-6 p-5 lg:grid-cols-5" data-surface-band={selected.slug}>
          <div className="space-y-4 lg:col-span-2">
            <TechniqueIdentity technique={selected} index={index} />
            <MechanismBlock technique={selected} />
            <InAscentBlock technique={selected} />
            <DeviationBlock technique={selected} />
          </div>
          <SourceBlock technique={selected} className="lg:col-span-3" />
        </Surface>
      ) : (
        <Surface radius="xl" className="p-5" data-surface-band="all">
          <Kicker tone="muted">Mechanism</Kicker>
          <p className="mt-2 type-body-sm text-slate-500">
            Every region of the scene is showing. Pick a channel above to shrink the canvas to that one technique and read how it is built.
          </p>
        </Surface>
      )}
    </div>
  );
}
