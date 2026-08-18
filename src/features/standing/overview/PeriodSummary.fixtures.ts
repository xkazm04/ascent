// Test-only support for the PeriodSummary suites (PeriodSummary.test.ts + PeriodSummary.counts.test.ts):
// the mirrored derivation under test plus the fixture builders both files drive it with. Extracted so
// each suite stays inside the 200-LOC file cap without either of them copying the mirror — one copy of
// the derivation means one place a drift from the component's maths shows up.
//
// This Vitest setup has no jsdom/RTL, and the component itself is gone, so `derivePeriodSummary` below
// mirrors PeriodSummary.tsx's inline derivation EXACTLY (lines 22-41) — the assertions in the suites pin
// the relationships the component computed. Nothing here reaches for a database: `isWithinNoise` is pure
// and everything else is a type-only import.

import type { RepoScoreSnap } from "@/lib/db/org-rollup";
import { isWithinNoise } from "@/lib/maturity/noise";
import type { OrgMovers, OrgRollup, RepoMove } from "@/lib/db";

// ── Mirror of PeriodSummary.tsx's inline derivation (lines 22-41). ─────────────────────────────────
// Returns the no-render signal (null) when there is no baseline/deltas, else the derived numbers and
// the two sentence fragments the component renders. Kept line-aligned with the component so a future
// extraction can drop straight in and these tests still pin it.
export interface Derived {
  cohortNow: number;
  onboarded: number;
  promoted: number;
  demoted: number;
  maturity: string;
  levels: string;
}
function plural(n: number, one: string, many = `${one}s`): string {
  return n === 1 ? one : many;
}
export const signedDelta = (d: number): string => `${d > 0 ? "+" : ""}${d}`;

export function derivePeriodSummary(rollup: OrgRollup, movers: OrgMovers | null): Derived | null {
  const { baseline, deltas } = rollup;
  if (!baseline || !deltas) return null; // the "All time" range — component returns null (renders nothing)

  const promoted = movers?.levelChanges.filter((m) => m.levelDelta > 0).length ?? 0;
  const demoted = movers?.levelChanges.filter((m) => m.levelDelta < 0).length ?? 0;
  const cohortNow = baseline.avgOverall + deltas.overall;
  const onboarded = Math.max(0, rollup.scannedCount - baseline.repos);

  const maturity = isWithinNoise(deltas.overall)
    ? deltas.overall === 0
      ? `Fleet maturity held at ${cohortNow}.`
      : `Fleet maturity held around ${cohortNow} — the ${signedDelta(deltas.overall)} shift is within the scan-to-scan noise band.`
    : `Fleet maturity ${deltas.overall > 0 ? "climbed" : "slipped"} ${signedDelta(deltas.overall)} to ${cohortNow} (from ${baseline.avgOverall}).`;

  const levels =
    promoted || demoted
      ? `${promoted ? `${promoted} ${plural(promoted, "repo")} leveled up` : ""}${promoted && demoted ? ", " : ""}${demoted ? `${demoted} slipped a level` : ""}.`
      : "No level changes across the fleet.";

  return { cohortNow, onboarded, promoted, demoted, maturity, levels };
}

// ── Fixture builders ──────────────────────────────────────────────────────────────────────────────
export const snap = (repoId: string, overall: number, adoption = overall, rigor = overall): RepoScoreSnap => ({
  repoId,
  overall,
  adoption,
  rigor,
});

/** A minimal OrgRollup carrying only the fields PeriodSummary reads (scannedCount, avgOverall, baseline, deltas). */
export function rollup(over: {
  scannedCount: number;
  avgOverall: number; // fleet-wide avg — a decoy the banner must NOT use as the "to"
  baseline: OrgRollup["baseline"];
  deltas: OrgRollup["deltas"];
}): OrgRollup {
  return {
    org: "acme",
    repoCount: over.scannedCount,
    scannedCount: over.scannedCount,
    avgOverall: over.avgOverall,
    avgAdoption: 0,
    avgRigor: 0,
    postureCounts: {},
    dimAverages: [],
    repos: [],
    trend: [],
    forecast: null,
    baseline: over.baseline,
    deltas: over.deltas,
    dimDeltas: null, // filler — required by OrgRollup, never read by the banner
  };
}

export function baseline(repos: number, avgOverall: number): NonNullable<OrgRollup["baseline"]> {
  return { asOf: "2026-03-01T00:00:00.000Z", repos, avgOverall, avgAdoption: avgOverall, avgRigor: avgOverall };
}

/** A RepoMove carrying only the field the level tallies read (levelDelta); the rest is filler. */
function move(levelDelta: number): RepoMove {
  return {
    fullName: "acme/r",
    name: "r",
    overall: 0,
    dOverall: 0,
    dAdoption: 0,
    dRigor: 0,
    levelFrom: "L2",
    levelTo: "L2",
    levelDelta,
    postureFrom: "manual",
    postureTo: "manual",
    sinceDays: 1,
    baselineKind: "period",
  };
}
export function movers(...levelDeltas: number[]): OrgMovers {
  const levelChanges = levelDeltas.map(move);
  return { gainers: [], regressers: [], held: [], levelChanges, onboarded: [], comparedRepos: levelChanges.length };
}
