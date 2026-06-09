/** A repo's latest standing, as seeded from the server rollup and updated live by the SSE stream. */
export interface LiveRepoSeed {
  fullName: string;
  name: string;
  overall: number | null;
  adoption: number | null;
  rigor: number | null;
  level: string | null;
  posture: string | null;
}

export interface LiveRepo extends LiveRepoSeed {
  /** Monotonic tick of the last live update (0 = seeded), used to flash freshly-landed rows. */
  updatedAt: number;
}

export interface Mover {
  id: number;
  fullName: string;
  name: string;
  overall: number | null;
  level: string | null;
  posture: string | null;
  /** Overall-score change vs this repo's previous scan, or null when first-ever scan. */
  delta: number | null;
  failed: boolean;
}

export interface Celebration {
  id: number;
  name: string;
  level: string | null;
  overall: number | null;
}

export type Phase = "idle" | "running" | "done" | "error";

export const TICKER_MAX = 14;
export const LEADER_MAX = 14;
export const CELEBRATION_MAX = 4;
export const CELEBRATION_MS = 5200;
export const ROW_H = 44; // px per leaderboard row (40px row + 4px gap), drives the reshuffle transition

/** Cool→warm hex per posture quadrant for the morphing distribution + leaderboard chips. */
export const POSTURE_HEX: Record<string, string> = {
  "ai-native": "#22c55e",
  ungoverned: "#f97316",
  manual: "#38bdf8",
  early: "#64748b",
};

export const shortName = (fullName: string) => fullName.split("/").pop() || fullName;
