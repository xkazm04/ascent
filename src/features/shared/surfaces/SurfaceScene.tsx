"use client";

// The client orchestrator for one showcase: resolves the selection (URL-synced technique, local
// knobs), loads the scene body AND the motion scope through the body map's `import()` — the one door
// framer-motion enters this tab by — and hands both to the frame. Loading shows an in-frame quiet
// gap (`reveal-quiet`: invisible for 150ms, so a fast chunk paints no placeholder at all); a failed
// import shows an inline error card with retry, never a blank canvas. Render crashes inside a scene
// are contained by the shell's OrgTabErrorBoundary around the whole tab.
//
// Keyed on `record.slug` by the tab, so a subject change remounts this and the load state with it.

import { useEffect, useState } from "react";
import { chipButtonClass } from "@/components/ui";
import { useReducedMotion } from "@/components/ui/useReducedMotion";
import type { SurfaceRecord } from "@/lib/org/surface-catalog";
import { SURFACE_BODIES } from "./surfaceBodies";
import { SurfaceFrame, type LoadedScene } from "./SurfaceFrame";
import type { FreshnessLabel } from "./SurfaceFreshnessBadge";
import { useSurfaceSelection } from "./useSurfaceSelection";

type LoadState = { status: "loading"; attempt: number } | { status: "ready"; scene: LoadedScene } | { status: "error"; message: string };

export function SurfaceScene({
  slug,
  record,
  freshness,
  initialTechnique,
}: {
  slug: string;
  record: SurfaceRecord;
  freshness: FreshnessLabel | null;
  initialTechnique: string | null;
}) {
  const sel = useSurfaceSelection(slug, record.techniqueSlugs, initialTechnique);
  const osReduced = useReducedMotion();
  const loader = SURFACE_BODIES[record.slug];
  const [load, setLoad] = useState<LoadState>(() =>
    loader ? { status: "loading", attempt: 0 } : { status: "error", message: `No scene body is registered for "${record.slug}".` },
  );
  const attempt = load.status === "loading" ? load.attempt : -1;

  useEffect(() => {
    if (attempt < 0 || !loader) return;
    let alive = true;
    Promise.all([loader(), import("./surfaceMotionScope")])
      .then(([body, scope]) => {
        if (alive) setLoad({ status: "ready", scene: { body, Scope: scope.MotionScope } });
      })
      .catch((err: unknown) => {
        if (alive) setLoad({ status: "error", message: err instanceof Error ? err.message : "The scene chunk failed to load." });
      });
    return () => {
      alive = false;
    };
  }, [attempt, loader]);

  const retry = () => setLoad({ status: "loading", attempt: Date.now() });

  const fallback =
    load.status === "error" ? (
      <div className="rounded-xl border border-danger/40 bg-danger/5 p-5" role="alert" data-surface-error="true">
        <p className="type-body-sm font-medium text-danger-soft">This scene could not be loaded.</p>
        <p className="mt-1 type-caption text-slate-400">{load.message}</p>
        {loader ? (
          <button type="button" className={chipButtonClass("idle", "mt-3")} onClick={retry}>
            Retry
          </button>
        ) : null}
      </div>
    ) : (
      <div className="reveal-quiet min-h-[24rem]" aria-hidden />
    );

  return (
    <SurfaceFrame
      record={record}
      freshness={freshness}
      sel={sel}
      osReduced={osReduced}
      loaded={load.status === "ready" ? load.scene : null}
      canvasFallback={fallback}
    />
  );
}
