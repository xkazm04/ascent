"use client";

// THROWAWAY PROTOTYPE SWITCHER (round 1, 2026-09-06) — A/B for the gallery layout.
//
// The shipped gallery (three-across cards with a summary paragraph each) is kept as "Baseline" for
// the comparison; the two candidates drop the prose and keep category + name as the metadata.
// Consolidation deletes this file and promotes the winner — no switcher survives the round.
//
// It is the one client component in the gallery path: the variants themselves use no hooks, so the
// winner goes back to being server-rendered the moment this strip is removed.

import { useState } from "react";
import type { SurfaceFreshness } from "@/lib/org/surface-freshness";
import { SurfacesGallery } from "./SurfacesGallery";
import { SurfacesGalleryColumns } from "./SurfacesGalleryColumns";
import { SurfacesGalleryLedger } from "./SurfacesGalleryLedger";

type GalleryProps = { slug: string; freshness: SurfaceFreshness; focusedSlug: string | null };

const VARIANTS = [
  { id: "ledger", label: "Ledger", note: "one table · category prints once per group", View: SurfacesGalleryLedger },
  { id: "columns", label: "Columns", note: "one column per subcategory · the whole corpus on a screen", View: SurfacesGalleryColumns },
  { id: "baseline", label: "Baseline (shipped)", note: "cards with summaries, three across", View: SurfacesGallery },
] as const;

export function SurfacesGallerySwitcher(props: GalleryProps) {
  const [variant, setVariant] = useState<(typeof VARIANTS)[number]["id"]>("ledger");
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
