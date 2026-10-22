// The /about X-Ray + ROI panes' data model (card about-1, the MC-B6 ceiling). Pure, no React, client-safe:
// the server page reads the cached public gallery and passes it down as a plain prop; this reduces it to
// the panes' cells and projections. The `@/lib/db` import below is TYPE-ONLY and erased at compile time,
// so the client bundle never reaches Prisma.
//
// Two registry rules shape it. public-claim-provenance / degraded-never-claims-live: below LIVE_MIN repos
// scored under the CURRENT rubric the panes stay the labelled illustration, never a padded live count. And
// the ROI arithmetic is the engine's own (overallScoreFor + levelForScore, the projectedGain math), so the
// pane and the org backlog's "+N pts · unlocks LX" cannot disagree.

import type { PublicRepoCard, PublicScanGallery } from "@/lib/db";
import { POSTURE_META, levelForScore, levelIndex, overallScoreFor } from "@/lib/maturity/model";
import type { DimensionId, RepoArchetype } from "@/lib/types";

/** Fewer current-rubric public repos than this and the panes do not claim to be live. */
export const LIVE_MIN = 6;
/** The X-Ray never renders more cells than the illustration did. */
export const FLEET_MAX = 40;

export type FleetMode = "live" | "illustrative";

/** What the server page hands the client deck: the cached public gallery, or null (no DB, DB down, empty). */
export type AboutGallery = PublicScanGallery | null;

export interface FleetCell {
  name: string;
  score: number;
  segment: string;
  /** The repo's own report permalink (live mode only). */
  href?: string;
}

/** The card facts a projection needs. */
export type FleetRepo = Pick<PublicRepoCard, "fullName" | "overall" | "dimensions" | "archetype" | "href">;

export interface AboutFleet {
  mode: FleetMode;
  cells: FleetCell[];
  /** Filter chips, in display order: postures present (live) or the sample segments (illustrative). */
  segments: { id: string; label: string }[];
  /** Live repos for the ROI pane; empty in illustrative mode. */
  repos: FleetRepo[];
  /** ISO time of the newest live scan; null in illustrative mode. */
  newest: string | null;
}

const SAMPLE_SEGMENTS = ["Platform", "Web", "Mobile", "Services", "Legacy"] as const;

// Relocated from FleetGrid: deterministic, integer-only (no trig/random -> identical on server + client).
const SAMPLE_CELLS: FleetCell[] = Array.from({ length: FLEET_MAX }, (_, i) => {
  const segment = SAMPLE_SEGMENTS[i % SAMPLE_SEGMENTS.length]!;
  return {
    name: `${segment.toLowerCase()}-${String(Math.floor(i / SAMPLE_SEGMENTS.length) + 1).padStart(2, "0")}`,
    segment,
    score: 15 + Math.round(((i * 37 + 11) % 100) * 0.7),
  };
});

export const ILLUSTRATIVE_FLEET: AboutFleet = {
  mode: "illustrative",
  cells: SAMPLE_CELLS,
  segments: SAMPLE_SEGMENTS.map((s) => ({ id: s, label: s })),
  repos: [],
  newest: null,
};

export function fleetFrom(gallery: PublicScanGallery | null | undefined): AboutFleet {
  // A stale-rubric score is a real rating on an earlier instrument, but not one the engine would give
  // today: it is excluded before the threshold, so it can never carry the panes over LIVE_MIN.
  const current = (gallery?.recent ?? []).filter((c) => c.currentRubric).slice(0, FLEET_MAX);
  if (current.length < LIVE_MIN) return ILLUSTRATIVE_FLEET;
  const present = new Set(current.map((c) => c.posture));
  return {
    mode: "live",
    cells: current.map((c) => ({ name: c.fullName, score: c.overall, segment: c.posture, href: c.href })),
    // POSTURE_META order; a posture absent from the data is never offered as an empty filter.
    segments: POSTURE_META.filter((p) => present.has(p.id)).map((p) => ({ id: p.id, label: p.label })),
    repos: current.map(({ fullName, overall, dimensions, archetype, href }) => ({
      fullName,
      overall,
      dimensions,
      archetype,
      href,
    })),
    newest: current.reduce((m, c) => (c.scannedAt > m ? c.scannedAt : m), current[0]!.scannedAt),
  };
}

export interface FleetProjectionRow {
  name: string;
  href: string;
  base: number;
  next: number;
  promoted: boolean;
  /** The level the projection lands in. */
  after: string;
}

export interface FleetProjection {
  rows: FleetProjectionRow[];
  promotions: number;
  affected: number;
  avgGain: number;
}

/**
 * Raise each targeted dimension to at least its target (a target below today's score never lowers it)
 * and re-run the headline blend. The gain is the engine's delta (overallScoreFor before vs after, under
 * the card's own archetype lens) added to the card's stored overall, and a promotion is a band crossing on
 * the same recomputed pair, exactly as projectedGain reports it. An absent dimension is not invented.
 */
export function projectFleet(
  repos: readonly FleetRepo[],
  targets: Partial<Record<DimensionId, number>>,
): FleetProjection {
  const rows = repos.map((r) => {
    const lens = r.archetype as RepoArchetype; // weightsFor falls back to the org lens for unknowns
    const scored = Object.entries(r.dimensions).map(([id, score]) => ({ id: id as DimensionId, score: score ?? 0 }));
    const raised = scored.map((d) => {
      const t = targets[d.id];
      return t != null && t > d.score ? { ...d, score: t } : d;
    });
    const current = overallScoreFor(scored, lens);
    const projected = overallScoreFor(raised, lens);
    const next = Math.min(100, r.overall + Math.max(0, projected - current));
    const to = levelForScore(projected);
    return {
      name: r.fullName,
      href: r.href,
      base: r.overall,
      next,
      promoted: levelIndex(to.id) > levelIndex(levelForScore(current).id),
      after: to.id,
    };
  });
  const gain = rows.reduce((s, r) => s + (r.next - r.base), 0);
  return {
    rows,
    promotions: rows.filter((r) => r.promoted).length,
    affected: rows.filter((r) => r.next > r.base).length,
    avgGain: rows.length ? Math.round(gain / rows.length) : 0,
  };
}

/** The provenance line under a pane. Illustrative wording is the X-Ray's pre-existing caption, verbatim. */
export function fleetCaption(f: { mode: FleetMode; n: number; newest: string | null }): string {
  if (f.mode === "illustrative") return `Illustrative · ${f.n} sample repos, not customer data`;
  const newest = f.newest ? ` · newest ${f.newest.slice(0, 10)}` : "";
  return `Live · ${f.n} public repos scanned by Ascent${newest}`;
}
