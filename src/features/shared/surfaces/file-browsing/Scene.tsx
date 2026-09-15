"use client";

// The file-browsing showcase: a "vault browser" over a fictional knowledge registry — a hierarchical
// store the surface does not own and a sync agent keeps writing to. Every technique of the registry's
// `file-browsing` subject is a region carrying `data-technique="<slug>"` (the frame spotlights the
// selected one): the tree + trail (navigation-state), the kind chips (kind-taxonomy), the directory
// listing (listing-and-refresh), the bulk bar (selection-model), the rename/move/trash bench
// (file-mutations) and the preview panel (thumbnails-and-previews). `reduced` and `volume` come from
// props — the scene never reads a media query; framer-motion is used only in the two panels that
// animate an entrance, and every loop-free region renders its full content under `reduced`.

import type { SurfaceSceneProps } from "../surfaceBody";
import { KindsRegion } from "./KindsRegion";
import { ListingRegion } from "./ListingRegion";
import { MutationsRegion } from "./MutationsRegion";
import { NavRegion } from "./NavRegion";
import { PreviewRegion } from "./PreviewRegion";
import { SelectionRegion } from "./SelectionRegion";
import { useVault } from "./useVault";

export function Scene({ reduced, volume }: SurfaceSceneProps) {
  const vault = useVault(volume);
  return (
    <div className="space-y-3" data-scene="file-browsing" data-reduced={reduced}>
      <p className="type-caption text-slate-500">
        Fixture data: <span className="text-slate-300">{volume.toLocaleString()}</span> fictional entries in a seeded vault ({vault.store.entries.size.toLocaleString()} nodes incl. folders), a 40-row window. Nothing here is an Ascent org.
      </p>
      <div className="grid gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <NavRegion vault={vault} />
        <div className="space-y-3">
          <KindsRegion vault={vault} />
          <ListingRegion vault={vault} />
        </div>
      </div>
      <SelectionRegion vault={vault} reduced={reduced} />
      <div className="grid gap-3 lg:grid-cols-2">
        <MutationsRegion vault={vault} reduced={reduced} />
        <PreviewRegion vault={vault} />
      </div>
    </div>
  );
}
