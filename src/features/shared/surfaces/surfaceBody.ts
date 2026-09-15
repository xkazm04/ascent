// The scene-body contract every showcased subject implements (spark ui-surfaces-showcase). Types
// only — no React import at runtime — so the catalog test, the body map and every scene can share it
// without dragging a component into a pure module.
//
// A body is `{ Scene, techniques }`: the composed scene and, for every technique the scene embodies,
// the drawer's four sections. The scene marks each technique's region with
// `data-technique="<slug>"`; the frame spotlights the selected one and dims the rest
// (surfaceSpotlight.ts), so a technique with no region is a technique the frame cannot point at —
// the per-scene jsdom test pins that every declared slug has one.

import type { ComponentType } from "react";
import type { SurfaceVolume } from "@/lib/org/surface-catalog";

export type SurfaceTechnique = {
  slug: string;
  title: string;
  /** 3–6 sentences: the React / Tailwind / Motion mechanism the region demonstrates. */
  mechanism: string;
  /** The actual excerpt of the scene code implementing it — a string constant, shown in a <pre>. */
  source: string;
  /** Where Ascent already realizes this, or null when it does not. */
  inAscent: { file: string; note: string } | null;
  /** Where Ascent falls short of the technique, or null when it does not. */
  deviation: string | null;
};

export type SurfaceSceneProps = {
  /** The technique whose region is spotlit, or null for the whole scene. */
  technique: string | null;
  /**
   * Reduced motion as the FRAME resolves it (the OS preference OR the toolbar's simulate toggle).
   * A scene reads this prop for every non-transform decision; it never runs its own media query —
   * the simulate toggle would otherwise be a lie for half the scene.
   */
  reduced: boolean;
  /** Fixture volume from the toolbar's chips. Scenes without list data still accept it. */
  volume: SurfaceVolume;
};

export type SurfaceBody = {
  Scene: ComponentType<SurfaceSceneProps>;
  techniques: readonly SurfaceTechnique[];
};
