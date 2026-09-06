// The body map: one dynamic `import()` per showcased subject, keyed by slug. This is the ONLY door
// framer-motion (and any other scene-only dependency) may enter the surfaces tab through — the frame,
// the gallery and the rail stay in the tab's own chunk; each scene is its own chunk that loads when
// its subject is selected. `surfaceCatalog.test.ts` pins this map against `SURFACE_CATALOG` in both
// directions, so a record without a body (or a body without a record) fails before it ships.
//
// Registering a scene: add `<slug>: () => import("./<slug>").then((m) => m.body)` here and its
// record in src/lib/org/surface-catalog.ts. The `/surface` skill does both.

import type { SurfaceBody } from "./surfaceBody";

export const SURFACE_BODIES: Record<string, () => Promise<SurfaceBody>> = {
  motion: () => import("./motion").then((m) => m.body),
};
