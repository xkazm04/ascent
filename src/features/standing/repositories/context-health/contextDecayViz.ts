// The fleet's context decay, as a FIELD rather than as a sentence.
//
// The panel's own metaphor is a decaying isotope, and until now it drew that only per row (a 132px
// sparkline in the third column) while the fleet-level reading — "these are the repos whose guidance
// has already stopped being true" — was a paragraph above four tiles. docs/ORG-UX-REDESIGN.md §2.2:
// the headline reading is a shape. This module computes it; FleetDecayScatter.tsx draws it.
//
// The shape is potency (y) against ≈commits-since-edit (x), with the fleet's MEDIAN decay curve
// through it. Both axes are already measured, and the curve is derived from the same points rather
// than assumed: every repo's own decay constant is recoverable from its potency and its commit
// count, so the median of those constants is the fleet's rate. A repo above the curve holds its
// guidance longer than the fleet median (more tolerant, better-sectioned files); one below decays
// faster. Nothing is synthesised — a repo that cannot supply a rate is simply not in the median.
//
// Pure: no React, no fetch. The kit types are `import type`.

import type { VizState } from "@/components/org/viz";
import type { RepoContextRow } from "./contextHealthModel";

/** One repo's position in the decay field. Only MEASURED repos get a point. */
export interface DecayPoint {
  id: string;
  label: string;
  /** ≈ commits landed since the guidance was last edited (weekly-bucket derived — approximate). */
  commits: number;
  /** 0..100 remaining potency. */
  potency: number;
  /** True below the 50% rule: the file is now more wrong than right. */
  pastHalfLife: boolean;
}

export interface DecayField {
  points: DecayPoint[];
  /** x-domain, ≥ 1 so a fleet that has landed no commits still has an axis. */
  maxCommits: number;
  /**
   * ≈ commits it takes the MEDIAN repo to lose half its potency, or null when no repo can supply a
   * rate (nothing has decayed yet, or nothing has commits). Null draws no curve — an invented decay
   * rate would be the fabrication this whole panel refuses.
   */
  halfCommits: number | null;
  /** Assessed, carrying guidance, but the freshness lookup degraded — hatched, and in no quartile. */
  unknown: number;
  /** Assessed and carrying NO guidance file — a void: there is nothing to decay. */
  absent: number;
  /** Scanned before context health existed — never judged, and never as "no context". */
  notAssessed: number;
  states: VizState[];
}

/** Compact day/month label, or ∞ for a repo whose commit rate is zero. Shared by every readout. */
export function days(d: number): string {
  if (!Number.isFinite(d)) return "∞";
  if (d < 1) return "<1d";
  if (d < 90) return `${Math.round(d)}d`;
  return `${(d / 30).toFixed(1)}mo`;
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? null;
}

/**
 * ≈ commits this repo needs to halve its potency, recovered from its own two measurements:
 * potency = 100·e^(−k·commits) ⇒ half-commits = ln2/k. Null where the row carries no rate
 * information — a repo at full potency, or one with no commits since the edit, has not decayed and
 * cannot say how fast it would.
 */
function halfCommitsOf(p: DecayPoint): number | null {
  if (p.commits <= 0 || p.potency >= 100 || p.potency <= 0) return null;
  const k = Math.log(100 / p.potency) / p.commits;
  return k > 0 ? Math.LN2 / k : null;
}

export function decayField(rows: readonly RepoContextRow[]): DecayField {
  const points: DecayPoint[] = rows
    .filter((r) => r.assessed && r.present && r.potency != null && r.commitsSinceEdit != null)
    .map((r) => ({
      id: r.fullName,
      label: r.fullName,
      commits: Math.max(0, r.commitsSinceEdit as number),
      potency: Math.max(0, Math.min(100, r.potency as number)),
      pastHalfLife: (r.potency as number) < 50,
    }));

  const unknown = rows.filter((r) => r.assessed && r.present && r.potency == null).length;
  const absent = rows.filter((r) => r.assessed && !r.present).length;
  const notAssessed = rows.filter((r) => r.scanned && !r.assessed).length;

  const states: VizState[] = [];
  if (points.length > 0) states.push("measured");
  if (unknown > 0 || notAssessed > 0) states.push("not-judged");
  if (absent > 0) states.push("missing");

  const halves = points.map(halfCommitsOf).filter((h): h is number => h != null);
  return {
    points,
    maxCommits: Math.max(1, ...points.map((p) => p.commits)),
    halfCommits: median(halves),
    unknown,
    absent,
    notAssessed,
    states,
  };
}

/** The median decay curve, sampled across the x-domain. Empty when there is no rate to draw. */
export function decayCurve(field: DecayField, samples = 24): { x: number; y: number }[] {
  if (field.halfCommits == null || field.halfCommits <= 0) return [];
  const k = Math.LN2 / field.halfCommits;
  return Array.from({ length: samples + 1 }, (_, i) => {
    const x = (i / samples) * field.maxCommits;
    return { x, y: 100 * Math.exp(-k * x) };
  });
}
