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
  /** True when the repo was skipped for lack of scan credits (no score produced, not a failure). */
  skipped?: boolean;
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

// Posture quadrants, leader-first, that the distribution bars are rendered over.
// Single source of truth is org/ui.tsx; re-exported here so war-room importers keep resolving.
export { POSTURE_ORDER } from "@/components/org/ui";
import { POSTURE_ORDER } from "@/components/org/ui";

/**
 * Width (0–100) of one posture bar as its TRUE share of the whole scored fleet — NOT normalized to
 * the leading bucket. Scaling to the max made the dominant posture always render as a full 100% bar
 * regardless of its real prevalence, overstating it on a projected war-room wall. The denominator is
 * `max(1, scored, Σcounts)`: the `1` guards an empty fleet against divide-by-zero (all bars → 0),
 * and folding in both `scored` and the summed counts keeps the bars honest even if the two disagree.
 */
export function postureBarPct(count: number, scored: number, counts: Record<string, number>): number {
  const total = Math.max(1, scored, POSTURE_ORDER.reduce((s, p) => s + (counts[p] ?? 0), 0));
  return Math.min(100, (count / total) * 100);
}

/** A bulk-scan SSE `repo` event, classified into the shapes the server emits. */
export type RepoEventClass =
  | { kind: "error"; message: string }
  | { kind: "skipped"; reason: string }
  | {
      kind: "scored";
      overall: number;
      adoption: number | null;
      rigor: number | null;
      level: string | null;
      posture: string | null;
    }
  | { kind: "invalid" };

const finiteOrNull = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * Classify one streamed `repo` payload from POST /api/org/scan. The server emits THREE shapes —
 * `{repo, error}` (scan failed), `{repo, skipped: "insufficient_credits"}` (credit reservation
 * lost, no score produced), and `{repo, overall, …}` (scored) — and the scored fold must never
 * accept a non-finite overall: an unhandled skip used to fall through to `Number(undefined)`,
 * overwrite the repo's real seeded standing with NaN, and render literal "NaN" headline tiles.
 */
export function classifyRepoEvent(d: Record<string, unknown>): RepoEventClass {
  if (d.error) return { kind: "error", message: String(d.error) };
  if (d.skipped) return { kind: "skipped", reason: String(d.skipped) };
  const overall = Number(d.overall);
  if (!Number.isFinite(overall)) return { kind: "invalid" };
  return {
    kind: "scored",
    overall,
    adoption: finiteOrNull(d.adoption),
    rigor: finiteOrNull(d.rigor),
    level: d.level != null ? String(d.level) : null,
    posture: d.posture != null ? String(d.posture) : null,
  };
}
