"use client";

// The framer-motion scope a scene runs inside: `MotionConfig` with `reducedMotion="user"` normally
// and `"always"` when the frame resolves reduced motion (OS preference or the simulate toggle).
//
// Loaded by the frame through `import()` — NEVER statically — so framer-motion stays out of the
// surfaces tab's own chunk (the gallery, rail and drawer need none of it) and enters only when a
// scene is opened, alongside the scene body. This is the first MotionConfig in the dashboard; the
// two marketing decks (src/components/about/AboutLanding.tsx) had the only others.
//
// `MotionConfig` degrades transform/layout props only; a scene reads `reduced` from its props for
// everything else (the SurfaceSceneProps contract) — the scope is the belt, the prop is the braces.

import { MotionConfig } from "framer-motion";
import type { ReactNode } from "react";

export function MotionScope({ reduced, children }: { reduced: boolean; children: ReactNode }) {
  return <MotionConfig reducedMotion={reduced ? "always" : "user"}>{children}</MotionConfig>;
}
