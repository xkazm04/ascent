"use client";

// Waved mounting (render-budget, the second cold-start corollary): when a commit legitimately shows
// many elements at once — the first frame, a fit-all — they mount in slices, one per animation frame,
// nearest-to-centre first, the next slice sized by how long the previous one actually took. The budget
// only grows: once `mounted` covers the set, later pans mount immediately with no re-stagger.

import { useEffect, useRef, useState } from "react";

export const WAVE_FRAME_BUDGET_MS = 8;
const FIRST_WAVE = 120;

export function useWavedMount(total: number): { mounted: number; waves: number; waveSize: number } {
  const [mounted, setMounted] = useState(0);
  const wave = useRef({ size: FIRST_WAVE, count: 0, scheduledAt: 0, pending: false });

  // Measure the slice that just committed — guarded, so a re-run for any other reason is not mistaken
  // for a slow frame — and size the next one from it.
  useEffect(() => {
    const w = wave.current;
    if (!w.pending) return;
    w.pending = false;
    const took = performance.now() - w.scheduledAt;
    if (took > WAVE_FRAME_BUDGET_MS) w.size = Math.max(40, Math.floor(w.size / 2));
    else if (took < WAVE_FRAME_BUDGET_MS / 2) w.size = Math.min(2000, w.size * 2);
  }, [mounted]);

  useEffect(() => {
    if (mounted >= total) return;
    const raf = requestAnimationFrame(() => {
      const w = wave.current;
      w.pending = true;
      w.scheduledAt = performance.now();
      w.count += 1;
      setMounted((m) => Math.min(total, m + w.size));
    });
    return () => cancelAnimationFrame(raf);
  }, [mounted, total]);

  return { mounted: Math.min(mounted, total), waves: wave.current.count, waveSize: wave.current.size };
}
