// thumbnails-and-previews: a thumbnail is a cached DERIVATION of file content, and the cache key
// names its recomputation — identity PLUS content version — so a rewritten file misses by
// construction and no "clear cache" folklore exists. Failure is cached too (a corrupt file is not
// re-decoded on every pass). The cache names its reaper at creation: a budget and an LRU eviction
// order. Generation is deterministic (seeded from the key) so a screenshot is reproducible. No React.

import { mulberry32, type Entry } from "./fixtures";
import { KINDS, type Rung } from "./kinds";

export type Thumb = { key: string; state: "ok"; bars: number[] } | { key: string; state: "failed"; reason: string };
export type CacheStats = { hits: number; misses: number; failures: number; evictions: number; size: number };

export const CACHE_BUDGET = 24;
export const thumbKey = (e: Entry): string => `${e.id}@v${e.version}`;

const hash = (s: string): number => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
};

/** The "decoder": five bar heights from the key, or a failure for bytes that do not decode. */
function decode(e: Entry): Thumb {
  const key = thumbKey(e);
  if (e.corrupt) return { key, state: "failed", reason: "bytes do not decode" };
  const rnd = mulberry32(hash(key));
  return { key, state: "ok", bars: Array.from({ length: 5 }, () => 0.25 + rnd() * 0.75) };
}

export class PreviewCache {
  private map = new Map<string, Thumb>();
  readonly stats: CacheStats = { hits: 0, misses: 0, failures: 0, evictions: 0, size: 0 };
  constructor(readonly budget = CACHE_BUDGET) {}

  /** Highest rung READY for this entry: a hit returns instantly, a miss decodes now (the scene's
   *  decoder is synchronous fiction; a real one would return rung 1 and fill in later). */
  get(e: Entry): Thumb {
    const key = thumbKey(e);
    const hit = this.map.get(key);
    if (hit) {
      this.map.delete(key);
      this.map.set(key, hit); // LRU: touch moves it to the young end
      this.stats.hits += 1;
      return hit;
    }
    const made = decode(e);
    this.stats.misses += 1;
    if (made.state === "failed") this.stats.failures += 1;
    this.map.set(key, made);
    while (this.map.size > this.budget) {
      const oldest = this.map.keys().next().value as string;
      this.map.delete(oldest); // the reaper, named here: oldest first, past the budget
      this.stats.evictions += 1;
    }
    this.stats.size = this.map.size;
    return made;
  }

  snapshot(): CacheStats {
    return { ...this.stats };
  }
}

/** Which rung an item renders: the highest its kind allows AND it has ready — never above, never a hole. */
export function rungFor(e: Entry, thumb: Thumb | null): Rung {
  const ceiling = KINDS[e.kind].maxRung;
  if (ceiling === 1) return 1;
  if (e.kind === "image") return thumb?.state === "ok" ? ceiling : 1; // a failed thumbnail leaves the kind icon, not a hole
  return ceiling; // documents and data preview inline from their text; no thumbnail rung
}

/** Deterministic inline-preview text for rung 3 of a document / data file. */
export function excerptFor(e: Entry): string {
  const rnd = mulberry32(hash(thumbKey(e)));
  const words = ["standard", "deviation", "recorded", "listing", "identity", "refresh", "verdict", "cache", "budget", "trail"];
  const pick = () => words[Math.floor(rnd() * words.length)];
  if (e.kind === "data") return `{ "id": "${e.id}", "version": ${e.version}, "${pick()}": "${pick()}" }`;
  return `${e.name} — v${e.version}. ${pick()} ${pick()} ${pick()} ${pick()} ${pick()}.`;
}
