"use client";

// The scene frame: toolbar (Kicker path, freshness badge, controls) · rail · canvas · drawer.
// Owns the SPOTLIGHT — after the body mounts and on every selection change it rings
// `[data-technique=<selected>]` inside the canvas and dims the rest (surfaceSpotlight.ts).
//
// Imports NO framer-motion: the MotionScope arrives with the body through `import()` (see
// SurfaceScene). `reduced` here is already the frame's resolution of OS preference OR simulate
// toggle; the scene receives it as a prop and never runs its own media query.

import { useEffect, useRef } from "react";
import { Kicker, Surface } from "@/components/ui";
import type { SurfaceRecord } from "@/lib/org/surface-catalog";
import type { ComponentType, ReactNode } from "react";
import type { SurfaceBody } from "./surfaceBody";
import { SurfaceControls } from "./SurfaceControls";
import { SurfaceDrawer } from "./SurfaceDrawer";
import { SurfaceFreshnessBadge, type FreshnessLabel } from "./SurfaceFreshnessBadge";
import { SurfaceRail } from "./SurfaceRail";
import { applySpotlight } from "./surfaceSpotlight";
import type { SurfaceSelectionApi } from "./useSurfaceSelection";

export type LoadedScene = { body: SurfaceBody; Scope: ComponentType<{ reduced: boolean; children: ReactNode }> };

export function SurfaceFrame({
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
  /** Null while the body chunk loads (or failed) — `canvasFallback` fills the canvas then. */
  loaded: LoadedScene | null;
  canvasFallback: ReactNode;
}) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const reduced = osReduced || sel.simulateReduced;
  const techniques = loaded?.body.techniques ?? [];
  const selected = techniques.find((t) => t.slug === sel.technique) ?? null;

  // Spotlight after every commit that could change the regions: the selection, the body arriving,
  // the knobs re-rendering the scene. Cheap (a querySelectorAll over one canvas) and idempotent.
  useEffect(() => {
    const root = canvasRef.current;
    if (root) applySpotlight(root, sel.technique);
  });

  return (
    <div className="space-y-4" data-surface-frame={record.slug}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Kicker tone="muted">
            UI surfaces / {record.subcategory} / {record.slug}
          </Kicker>
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <h2 className="type-lede font-semibold text-white">{record.title}</h2>
            <SurfaceFreshnessBadge label={freshness} />
            <span className="type-caption text-slate-500">
              authored {record.authoredAgainst.verifiedOn} against {record.authoredAgainst.digest}
            </span>
          </div>
        </div>
        <SurfaceControls
          volume={sel.volume}
          onVolume={sel.setVolume}
          simulateReduced={sel.simulateReduced}
          onSimulateReduced={sel.setSimulateReduced}
          osReduced={osReduced}
          galleryHref={sel.galleryHref}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[12rem_minmax(0,1fr)_20rem]">
        <SurfaceRail techniques={techniques} selected={sel.technique} onSelect={sel.setTechnique} onStep={sel.step} />
        <Surface tone="strong" className="min-h-[28rem] p-5" data-surface-canvas={record.slug}>
          <div ref={canvasRef} className="min-h-full">
            {loaded ? (
              <loaded.Scope reduced={reduced}>
                <loaded.body.Scene technique={sel.technique} reduced={reduced} volume={sel.volume} />
              </loaded.Scope>
            ) : (
              canvasFallback
            )}
          </div>
        </Surface>
        <SurfaceDrawer technique={selected} />
      </div>
    </div>
  );
}
