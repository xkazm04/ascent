import { scoreHex } from "@/lib/ui";

interface RepoStar {
  fullName: string;
  /** Persisted overall maturity score (0..100), or null when not yet scanned. */
  overall: number | null;
  level: string | null;
  /** Overall-score change over the last 30 days (MAP-3 movers), or null when not measurable. */
  dOverall: number | null;
  /** Whether the repo is on the org's watchlist — drives the "watched only" map filter. */
  watched: boolean;
  /** True for a star APPENDED mid-scan by applyScanEvent (a repo the initial /api/app/repos pull
   *  didn't include). Appended stars are laid out on the outer "incoming" ring WITHOUT entering the
   *  phyllotaxis `total`, so landing one never re-seats the whole constellation mid-animation; the
   *  next authoritative refresh (mergeStars) clears the flag and re-flows everything at once. */
  appended?: boolean;
}

export type { RepoStar };

export type Constellation =
  | { id: number; login: string; status: "loading" }
  | { id: number; login: string; status: "error"; message: string }
  | { id: number; login: string; status: "done"; repos: RepoStar[] };

/** Shape of the `/api/app/repos` rows we read (a subset of the route's AppRepo). */
interface ApiRepo {
  fullName: string;
  state: { level: string | null; overall: number | null; watched?: boolean } | null;
  dOverall?: number | null;
}

export const MAX_STARS = 80;
export const SKELETON_STARS = 9;
/** Above this many total fleet stars the per-star twinkle is a steady-state repaint (up to N×MAX_STARS
 *  nodes animating forever). Past the cap the field renders static (still honoring reduced-motion for
 *  everyone) — the constellations read the same, without the large-fleet paint cost. (launch-fleet-map #7) */
export const DENSE_FLEET_STARS = 240;
const GOLDEN = Math.PI * (3 - Math.sqrt(5));
export const CENTER = 60;
export const ACCENT = "#3b9eff";
export const FAINT = "#64748b";
// The launch map's mover-direction palette (riser = emerald, faller = orange). Shared by the
// per-star directional ring and the header "movers · 30d" stat so the up/down semantic stays in
// one place. NOTE: deliberately distinct from the org DIRECTION_TONE palette — this is the
// launch constellation's own brighter pair, not that token.
export const RISER = "#34d399";
export const FALLER = "#f97316";

/** Stable 0..1 hash so star positions are deterministic (no SSR/CSR drift, no jitter on re-render). */
function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

/** Memo of placed positions, keyed by the ONLY inputs that move a star: (index, total, seed). A live
 *  SSE frame rewrites a star's score/level but never its index/total/seed, so every unchanged star is a
 *  Map hit and recomputes zero trig/hashes — only a star whose layout genuinely shifted (a repo added or
 *  removed changes `total`, hence every key) is placed again. Deterministic ⇒ the cached value equals what
 *  the pure math would return, so SSR/CSR still agree. Bounded by MAX_STARS × repos × distinct totals seen.
 *  (launch-fleet-map #3: the whole constellation re-rendered on every frame, recomputing all positions.) */
const positionCache = new Map<string, { cx: number; cy: number }>();

/** Phyllotaxis (sunflower) placement — organic, star-map-like spread inside the 120×120 field. Memoized
 *  by (i, total, seed) so a score-only re-render doesn't recompute any position (see positionCache). */
export function starPosition(i: number, total: number, seed: string): { cx: number; cy: number } {
  const key = `${i}:${total}:${seed}`;
  const cached = positionCache.get(key);
  if (cached) return cached;
  const jitter = hash01(seed);
  const angle = i * GOLDEN + jitter * 0.6;
  const radius = 13 + Math.sqrt((i + 0.6) / Math.max(total, 1)) * 42; // ~13..55
  const pos = { cx: CENTER + Math.cos(angle) * radius, cy: CENTER + Math.sin(angle) * radius };
  positionCache.set(key, pos);
  return pos;
}

/** Placement for a star APPENDED mid-scan (see RepoStar.appended): a fixed outer "incoming" ring just
 *  beyond the phyllotaxis band (radius 13..55), angled by the repo's own hash. Depends only on the
 *  seed — never on `total` — so appending a star cannot shift any existing star, and the appended
 *  star itself renders regardless of the MAX_STARS slice (a successful scan result must never be
 *  invisible at the cap). Deterministic ⇒ SSR/CSR agree. (ambiguity-ui launch-fleet-map #4) */
export function appendedStarPosition(seed: string): { cx: number; cy: number } {
  const angle = hash01(seed) * Math.PI * 2;
  const radius = 56; // outside the 13..55 phyllotaxis band, and 60+56+r(max 3.4) stays inside the 120 viewBox
  return { cx: CENTER + Math.cos(angle) * radius, cy: CENTER + Math.sin(angle) * radius };
}

/** Maturity → brightness: brighter, larger, fully-saturated stars for higher-scoring repos. */
export function starLook(overall: number | null): { color: string; r: number; opacity: number } {
  if (overall == null) return { color: FAINT, r: 1.1, opacity: 0.32 };
  const t = Math.max(0, Math.min(100, overall)) / 100;
  return { color: scoreHex(overall), r: 1.5 + t * 1.9, opacity: 0.55 + t * 0.45 };
}

export function mapRepos(raw: unknown): RepoStar[] {
  if (!Array.isArray(raw)) return [];
  return (raw as ApiRepo[]).map((r) => ({
    fullName: String(r.fullName),
    overall: r.state?.overall ?? null,
    level: r.state?.level ?? null,
    dOverall: typeof r.dOverall === "number" ? r.dOverall : null,
    watched: Boolean(r.state?.watched),
  }));
}
