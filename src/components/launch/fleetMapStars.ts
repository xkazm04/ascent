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

/** Phyllotaxis (sunflower) placement — organic, star-map-like spread inside the 120×120 field. */
export function starPosition(i: number, total: number, seed: string): { cx: number; cy: number } {
  const jitter = hash01(seed);
  const angle = i * GOLDEN + jitter * 0.6;
  const radius = 13 + Math.sqrt((i + 0.6) / Math.max(total, 1)) * 42; // ~13..55
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
