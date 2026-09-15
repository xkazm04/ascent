"use client";

// The scene's selection model: which technique's drawer is open (DEEP-LINKABLE as `?technique=`,
// tab-scoped so a tab switch clears it), plus two knobs that are NOT in the URL — the simulated
// reduced-motion toggle and the fixture volume. A simulated preference is not a shareable state:
// a link that opened someone else's scene in reduced mode would be asserting a preference for them.
//
// URL patches go through `router.replace` off the React-tracked search string, never
// `window.location`, for the reason `buildUrl` states.

import { useCallback, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { buildUrl } from "@/lib/org/orgTabs";
import { SURFACE_VOLUMES, type SurfaceVolume } from "@/lib/org/surface-catalog";

export function useSurfaceSelection(slug: string, techniqueSlugs: readonly string[], initialTechnique: string | null) {
  const router = useRouter();
  const search = useSearchParams();
  const valid = (t: string | null) => (t && techniqueSlugs.includes(t) ? t : null);
  const [technique, setTechniqueState] = useState<string | null>(valid(initialTechnique));
  const [simulateReduced, setSimulateReduced] = useState(false);
  const [volume, setVolume] = useState<SurfaceVolume>(SURFACE_VOLUMES[0]);

  const setTechnique = useCallback(
    (next: string | null) => {
      setTechniqueState(next);
      router.replace(buildUrl(slug, { technique: next }, search.toString()), { scroll: false });
    },
    [router, search, slug],
  );

  /** Rail keyboard nav: step to the previous/next technique, wrapping. */
  const step = useCallback(
    (delta: 1 | -1) => {
      if (!techniqueSlugs.length) return;
      const i = technique ? techniqueSlugs.indexOf(technique) : -1;
      const n = (i + delta + techniqueSlugs.length) % techniqueSlugs.length;
      const next = techniqueSlugs[n];
      if (next !== undefined) setTechnique(next);
    },
    [technique, techniqueSlugs, setTechnique],
  );

  /** The href back to the gallery: drops subject + technique, keeps everything cross-tab. */
  const galleryHref = buildUrl(slug, { subject: null, technique: null }, search.toString());

  return { technique, setTechnique, step, simulateReduced, setSimulateReduced, volume, setVolume, galleryHref };
}

export type SurfaceSelectionApi = ReturnType<typeof useSurfaceSelection>;
