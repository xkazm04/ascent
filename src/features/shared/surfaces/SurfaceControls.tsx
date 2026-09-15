"use client";

// The scene toolbar's controls: the fixture volume chips, the "simulate reduced motion" toggle and
// the way back to the gallery. Chips are the brand's action chip (`chipButtonClass`); the toggle is
// a pressed button, not a checkbox, because it is a mode the scene is in, not a field.

import Link from "next/link";
import { chipButtonClass } from "@/components/ui";
import { SURFACE_VOLUMES, type SurfaceVolume } from "@/lib/org/surface-catalog";

const fmtVolume = (v: number): string => (v >= 1000 ? `${v / 1000}k` : String(v));

export function SurfaceControls({
  volume,
  onVolume,
  simulateReduced,
  onSimulateReduced,
  osReduced,
  galleryHref,
}: {
  volume: SurfaceVolume;
  onVolume: (v: SurfaceVolume) => void;
  simulateReduced: boolean;
  onSimulateReduced: (v: boolean) => void;
  /** The OS preference, so the toggle can say when it is moot. */
  osReduced: boolean;
  galleryHref: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div role="group" aria-label="Fixture volume" className="flex items-center gap-1">
        <span className="mr-1 type-caption text-slate-500">rows</span>
        {SURFACE_VOLUMES.map((v) => (
          <button
            key={v}
            type="button"
            className={chipButtonClass(v === volume ? "success" : "idle", "px-2 py-1")}
            aria-pressed={v === volume}
            onClick={() => onVolume(v)}
          >
            {fmtVolume(v)}
          </button>
        ))}
      </div>
      <button
        type="button"
        className={chipButtonClass(simulateReduced ? "success" : "idle", "px-2 py-1")}
        aria-pressed={simulateReduced}
        onClick={() => onSimulateReduced(!simulateReduced)}
        title={osReduced ? "Your OS already asks for reduced motion; the scene is reduced regardless." : "Render the scene as a reduced-motion reader sees it."}
      >
        {osReduced ? "reduced by OS" : simulateReduced ? "reduced motion: on" : "simulate reduced motion"}
      </button>
      <Link href={galleryHref} className={chipButtonClass("idle", "px-2 py-1")}>
        ← all surfaces
      </Link>
    </div>
  );
}
