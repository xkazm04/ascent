// Pure derivations shared by the Overview prototype variants (Front page · Altimeter): the STANDING
// (one figure + its level + its period delta, lifted off the badge list the server already builds),
// the TAKEAWAY sentence (≤ 8 words — the one thing the page must say before it shows any data), the
// MOVERS (the repos that really moved this period) and the FIX-FIRST dimensions (the owed ones,
// weakest first). No React, so the no-jsdom vitest setup can pin every line.

import { toneFor } from "@/components/ui/format";
import { movedRepos, type RepoTrajectory } from "./repoTrajectory";
import type { ScoreBadge } from "./OrgScoreBadges";
import type { DimensionReading } from "./dimensionReading";

export interface Standing {
  /** Fleet average; null when NO repo in the view has been scanned (a 0 there is not a grade). */
  overall: number | null;
  /** "L3" / "Augmented", parsed off the maturity badge's "L3 · Augmented" qualifier. */
  levelId: string | null;
  levelName: string | null;
  /** Cohort-matched period movement; null when the window has no baseline. */
  delta: number | null;
  adoption: number | null;
  rigor: number | null;
  scanned: number;
  repos: number;
}

const num = (v: string | number | undefined): number | null => (typeof v === "number" ? v : null);

/** Lift the standing off buildScoreBadges' output — by label, so a reordered strip still reads. */
export function standingOf(badges: ScoreBadge[]): Standing {
  const by = (label: string) => badges.find((b) => b.label === label);
  const maturity = by("Org maturity");
  const coverage = String(by("Repos scanned")?.value ?? "0/0");
  const [scanned = 0, repos = 0] = coverage.split("/").map((s) => Number.parseInt(s, 10) || 0);
  const [levelId, levelName] = (maturity?.sub ?? "").split(" · ");
  const measured = scanned > 0;
  return {
    overall: measured ? num(maturity?.value) : null,
    levelId: measured && levelId ? levelId : null,
    levelName: measured && levelName ? levelName : null,
    delta: measured && maturity?.delta != null ? maturity.delta : null,
    adoption: measured ? num(by("AI Adoption")?.value) : null,
    rigor: measured ? num(by("Engineering Rigor")?.value) : null,
    scanned,
    repos,
  };
}

/** The verb the period movement earns: a within-noise wobble reads as "holding", never as a trend. */
export function trendVerb(delta: number | null): string {
  if (delta === null) return "no baseline yet";
  const tone = toneFor(delta);
  return tone === "rising" ? "climbing" : tone === "falling" ? "slipping" : "holding";
}

/** Owed dimensions (below the green band), weakest first — the punch-list, capped. */
export function fixFirstDims(readings: DimensionReading[], n = 3): DimensionReading[] {
  return readings
    .filter((r) => r.owed)
    .sort((a, b) => a.rank - b.rank)
    .slice(0, n);
}

export interface Takeaway {
  /** "Augmented at 62, climbing." — the standing half. */
  lead: string;
  /** The dimension that owes first, or null when every dimension is green. */
  fix: DimensionReading | null;
  /** "Testing owes first." / "Every dimension is green." — the action half. */
  action: string;
}

/**
 * The ≤ 8-word sentence the page leads with, composed from the standing and the weakest owed
 * dimension: "Augmented at 62, climbing. Testing owes first." A view with no scanned repo gets the
 * empty-state sentence instead of a 0 dressed as a grade.
 */
export function takeawayOf(s: Standing, readings: DimensionReading[]): Takeaway {
  if (s.overall === null) {
    return { lead: "No standing yet.", fix: null, action: "Scan a repository to take the first reading." };
  }
  const fix = fixFirstDims(readings, 1)[0] ?? null;
  const lead = `${s.levelName ?? "Fleet"} at ${s.overall}, ${trendVerb(s.delta)}.`;
  const action = fix ? `${fix.short} owes first.` : "Every dimension is green.";
  return { lead, fix, action };
}

export interface Movers {
  risers: RepoTrajectory[];
  fallers: RepoTrajectory[];
  /** Repos with a real (non-engine-transition, ≥ 2 scans) window delta — the honest denominator. */
  moved: number;
}

/** The biggest real movers each way, largest magnitude first. Mock→live transitions never count. */
export function pickMovers(rows: RepoTrajectory[], n = 3): Movers {
  const moved = movedRepos(rows);
  const risers = moved.filter((r) => r.tone === "rising").sort((a, b) => (b.deltaWindow ?? 0) - (a.deltaWindow ?? 0));
  const fallers = moved.filter((r) => r.tone === "falling").sort((a, b) => (a.deltaWindow ?? 0) - (b.deltaWindow ?? 0));
  return { risers: risers.slice(0, n), fallers: fallers.slice(0, n), moved: moved.length };
}

/** "12 AI-Native · 5 Fast & Ungoverned" — zero-count postures are omitted, not greyed. */
export function postureLine(counts: Record<string, number>, order: readonly string[], label: (p: string) => string): string {
  return order
    .filter((p) => (counts[p] ?? 0) > 0)
    .map((p) => `${counts[p]} ${label(p)}`)
    .join(" · ");
}
