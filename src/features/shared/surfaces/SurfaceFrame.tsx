"use client";

// The scene frame: three rows, one technique at a time.
//
//   row 1  masthead + a numbered index of the subject's techniques (a table of contents, not a
//          segmented control: every entry is its own tab stop, the way a list of links is)
//   row 2  the canvas, showing ONLY the selected technique's region
//   row 3  ONE page of the file at a time — Mechanism / Source / In Ascent / Deviation as chips
//
// Won the 2026-09-06 prototype round over a three-column console and the shipped layout. The
// shipped one put the rail, the whole composed scene and a 20rem drawer side by side, so a
// ten-region subject was a 3076px page and every line of source wrapped in the drawer; this is
// ~1065px and the source gets the full width. The chosen reading page stays chosen while you move
// through techniques, so "read the source of each one in turn" is one click and then the index.
//
// The scene stays MOUNTED while you switch: `applySoloRegion` takes the other regions out of
// layout, so an instrument that has been running keeps its state when you come back to it.
//
// Imports NO framer-motion: the MotionScope arrives with the body through `import()` (see
// SurfaceScene). `reduced` here is already the frame's resolution of OS preference OR simulate
// toggle; the scene receives it as a prop and never runs its own media query.

import { useEffect, useRef, useState } from "react";
import { HairlineGrid, Kicker, Surface, chipButtonClass } from "@/components/ui";
import type { SurfaceRecord } from "@/lib/org/surface-catalog";
import type { ReactNode } from "react";
import type { LoadedScene, SurfaceTechnique } from "./surfaceBody";
import { SurfaceControls } from "./SurfaceControls";
import type { FreshnessLabel } from "./SurfaceFreshnessBadge";
import { SurfaceHeader } from "./SurfaceHeader";
import { DeviationBlock, InAscentBlock, MechanismBlock, SourceBlock, TechniqueIdentity } from "./SurfaceMechanismParts";
import { applySoloRegion } from "./surfaceSpotlight";
import type { SurfaceSelectionApi } from "./useSurfaceSelection";

const PAGES = [
  { id: "mechanism", label: "Mechanism" },
  { id: "source", label: "Source" },
  { id: "ascent", label: "In Ascent" },
  { id: "deviation", label: "Deviation" },
] as const;
type PageId = (typeof PAGES)[number]["id"];

function ReaderPage({ page, technique }: { page: PageId; technique: SurfaceTechnique }) {
  if (page === "source") return <SourceBlock technique={technique} />;
  if (page === "ascent") return <InAscentBlock technique={technique} />;
  if (page === "deviation") return <DeviationBlock technique={technique} />;
  return <MechanismBlock technique={technique} />;
}

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
  const [showAll, setShowAll] = useState(false);
  const [page, setPage] = useState<PageId>("mechanism");
  const reduced = osReduced || sel.simulateReduced;
  const techniques = loaded?.body.techniques ?? [];
  // The resting state is ONE region: with no `?technique=` in the URL the first one is live.
  const active = showAll ? null : sel.technique ?? techniques[0]?.slug ?? null;
  const index = techniques.findIndex((t) => t.slug === active);
  const selected = index >= 0 ? techniques[index] : undefined;

  // After every commit that could change the regions: the selection, the body arriving, the knobs
  // re-rendering the scene. Cheap (a querySelectorAll over one canvas) and idempotent.
  useEffect(() => {
    const root = canvasRef.current;
    if (root) applySoloRegion(root, active);
  });

  return (
    <div className="space-y-4" data-surface-frame={record.slug}>
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

      <nav aria-label="Techniques">
        <div className="mb-2 flex items-baseline justify-between gap-3">
          <Kicker tone="muted">{techniques.length} techniques</Kicker>
          <button
            type="button"
            onClick={() => setShowAll(true)}
            aria-pressed={showAll}
            className={`focus-ring type-caption transition ${showAll ? "text-accent" : "text-slate-500 hover:text-slate-300"}`}
          >
            show the whole scene
          </button>
        </div>
        <HairlineGrid className="grid-cols-2 md:grid-cols-3 xl:grid-cols-5">
          {techniques.map((t, i) => {
            const current = t.slug === active;
            return (
              <button
                key={t.slug}
                type="button"
                data-slug={t.slug}
                aria-current={current ? "true" : undefined}
                onClick={() => {
                  setShowAll(false);
                  sel.setTechnique(t.slug);
                }}
                className={`focus-ring flex h-full items-baseline gap-2 p-3 text-left transition ${
                  current ? "bg-accent/10 text-white" : "bg-ink text-slate-400 hover:bg-surface/60"
                }`}
              >
                <span className={`type-caption tabular-nums ${current ? "text-accent" : "text-slate-600"}`}>{String(i + 1).padStart(2, "0")}</span>
                <span className="type-body-sm">{t.title}</span>
              </button>
            );
          })}
        </HairlineGrid>
      </nav>

      <Surface tone="strong" className="min-h-[18rem] p-5" data-surface-canvas={record.slug}>
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

      <Surface radius="xl" className="space-y-4 p-5" data-surface-band={selected ? selected.slug : "all"}>
        {selected ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <TechniqueIdentity technique={selected} index={index} />
              <div role="group" aria-label="Reading" className="flex flex-wrap gap-1">
                {PAGES.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className={chipButtonClass(p.id === page ? "success" : "idle", "px-2 py-1")}
                    aria-pressed={p.id === page}
                    onClick={() => setPage(p.id)}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
            <ReaderPage page={page} technique={selected} />
          </>
        ) : (
          <>
            <Kicker tone="muted">Reading</Kicker>
            <p className="type-body-sm text-slate-500">
              The whole scene is showing. Pick a technique from the index to shrink the canvas to that region and open its file.
            </p>
          </>
        )}
      </Surface>
    </div>
  );
}
