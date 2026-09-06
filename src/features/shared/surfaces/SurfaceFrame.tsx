"use client";

// THROWAWAY PROTOTYPE SWITCHER (round 1, 2026-09-06) — A/B for the scene layout.
//
// The shipped frame (three columns, every region on screen, a 20rem drawer) is kept as "Baseline"
// so the comparison has a reference; the two candidates are three-ROW layouts that render one
// technique's region at a time. Consolidation deletes this file's strip and promotes the winner —
// no switcher survives the round.
//
// Every variant takes the identical props, so SurfaceScene (and the type it imports from here)
// is untouched by the round.

import { useState } from "react";
import type { SurfaceRecord } from "@/lib/org/surface-catalog";
import type { ReactNode } from "react";
import type { LoadedScene } from "./surfaceBody";
import type { FreshnessLabel } from "./SurfaceFreshnessBadge";
import { SurfaceFrameBaseline } from "./SurfaceFrameBaseline";
import { SurfaceFrameConsole } from "./SurfaceFrameConsole";
import { SurfaceFrameDossier } from "./SurfaceFrameDossier";
import type { SurfaceSelectionApi } from "./useSurfaceSelection";

export type { LoadedScene };

type FrameProps = {
  record: SurfaceRecord;
  freshness: FreshnessLabel | null;
  sel: SurfaceSelectionApi;
  osReduced: boolean;
  loaded: LoadedScene | null;
  canvasFallback: ReactNode;
};

const VARIANTS = [
  { id: "console", label: "Console", note: "3 rows · one channel at a time · wide readout band", View: SurfaceFrameConsole },
  { id: "dossier", label: "Dossier", note: "3 rows · numbered index · one page of the file at a time", View: SurfaceFrameDossier },
  { id: "baseline", label: "Baseline (shipped)", note: "3 columns · every region at once · 20rem drawer", View: SurfaceFrameBaseline },
] as const;

export function SurfaceFrame(props: FrameProps) {
  const [variant, setVariant] = useState<(typeof VARIANTS)[number]["id"]>("console");
  const active = VARIANTS.find((v) => v.id === variant) ?? VARIANTS[0];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-px overflow-hidden rounded-xl border border-divider bg-divider" role="group" aria-label="Layout prototype">
        <span className="bg-ink px-3 py-2 type-caption text-slate-600">prototype</span>
        {VARIANTS.map((v) => (
          <button
            key={v.id}
            type="button"
            onClick={() => setVariant(v.id)}
            aria-pressed={v.id === variant}
            className={`focus-ring flex-1 px-3 py-2 text-left transition ${v.id === variant ? "bg-accent/10 text-white" : "bg-ink text-slate-400 hover:bg-surface/60"}`}
          >
            <span className="type-body-sm font-medium">{v.label}</span>
            <span className="ml-2 type-caption text-slate-500">{v.note}</span>
          </button>
        ))}
      </div>
      <active.View {...props} />
    </div>
  );
}
