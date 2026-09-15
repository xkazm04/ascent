// Deterministic fixtures for the motion scene. Seeded (mulberry32), so every reader — and every
// screenshot — sees the same rows at the same volume; a randomized stand-in would turn one document's
// example into a different example per load (content-bearing-degradation's determinism rule). No React.

import type { SurfaceVolume } from "@/lib/org/surface-catalog";

export type Row = { id: string; label: string; value: number };

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS = ["alloy", "basalt", "cirrus", "delta", "ember", "fathom", "granite", "harbor", "isobar", "juniper", "kestrel", "lumen"];

/** `volume` rows with system-of-record identities (`row-<n>`), never positional. */
export function rowsFor(volume: SurfaceVolume, seed = 7): Row[] {
  const rnd = mulberry32(seed);
  const out: Row[] = [];
  for (let i = 0; i < volume; i++) {
    out.push({ id: `row-${i + 1}`, label: `${WORDS[i % WORDS.length]}-${String(i + 1).padStart(2, "0")}`, value: Math.round(rnd() * 900 + 100) });
  }
  return out;
}

/**
 * One poll: the same identities re-delivered (values drift), plus — on every second poll — ONE
 * genuinely new identity inserted at the top. The guard must let only that one enter.
 */
export function pollRows(rows: Row[], poll: number): Row[] {
  const rnd = mulberry32(100 + poll);
  const drifted = rows.map((r) => ({ ...r, value: Math.max(100, Math.round(r.value + (rnd() - 0.5) * 40)) }));
  if (poll > 0 && poll % 2 === 0) drifted.unshift({ id: `new-${poll}`, label: `arrival-${poll}`, value: Math.round(rnd() * 900 + 100) });
  return drifted;
}

/** The figure the content-bearing count-up resolves to — the real value, never a confident zero. */
export const HEADLINE_FIGURE = 4_812;
export const HEADLINE_TEXT = "Every gesture names what stops it.";
