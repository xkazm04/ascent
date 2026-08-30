// Pure derivation for the "Next rung" variant — the fleet's standing read as a CLIMB: where it
// stands, the next level and the distance to it, whether the period moved it, and at that pace how
// many periods the rung is away. Every input is already on OverviewLedgerData; no new query.
//
// The headline number is the standing strip's "Org maturity" badge (the rollup's avgOverall), not a
// re-average of the trajectories, so this variant can never disagree with the baseline's headline.

import { LEVELS, levelForScore, levelIndex, nextLevel } from "@/lib/maturity/model";
import { toneFor } from "@/components/ui/format";
import type { MaturityLevel } from "@/lib/types";
import type { ScoreBadge } from "./OrgScoreBadges";
import type { RepoTrajectory } from "./repoTrajectory";

export type ClimbVerdict = "climbing" | "holding" | "slipping";

export interface NextRungReading {
  /** Fleet average; null when nothing is scored in the window. */
  avg: number | null;
  level: MaturityLevel;
  /** The rung above; null at L5. */
  next: MaturityLevel | null;
  /** Points to the next rung's floor; 0 at the top. */
  distance: number;
  /** Cohort-matched period movement; null without a baseline. */
  delta: number | null;
  verdict: ClimbVerdict | null;
  /** Periods like this one until the rung, at the period's pace; null unless climbing and below it. */
  periodsToRung: number | null;
  adoption: number | null;
  rigor: number | null;
  /** The axis that trails — the one to push. null when tied or unknown. */
  lever: "adoption" | "rigor" | null;
  /** Repos already at or above the next rung (the proof it is reachable). */
  atNextRung: number;
  repos: number;
  scanned: string | null;
}

const numeric = (b: ScoreBadge | undefined): number | null =>
  b && typeof b.value === "number" && Number.isFinite(b.value) ? b.value : null;

export function readNextRung(badges: ScoreBadge[], trajectories: RepoTrajectory[]): NextRungReading {
  const by = (label: string) => badges.find((b) => b.label === label);
  const standing = by("Org maturity");
  const avg = trajectories.length ? numeric(standing) : null;
  const level = levelForScore(avg ?? 0);
  const next = avg === null ? LEVELS[1]! : nextLevel(level.id);
  const distance = avg === null || !next ? 0 : Math.max(0, next.band[0] - avg);
  const delta = standing?.delta ?? null;
  const tone = delta === null ? null : toneFor(delta);
  const verdict: ClimbVerdict | null = tone === null ? null : tone === "rising" ? "climbing" : tone === "falling" ? "slipping" : "holding";
  const periodsToRung = verdict === "climbing" && delta && distance > 0 ? Math.ceil(distance / delta) : null;
  const adoption = numeric(by("AI Adoption"));
  const rigor = numeric(by("Engineering Rigor"));
  const lever = adoption === null || rigor === null || adoption === rigor ? null : adoption < rigor ? "adoption" : "rigor";
  const nextIdx = next ? levelIndex(next.id) : LEVELS.length;
  const atNextRung = trajectories.filter((t) => levelIndex(t.level) >= nextIdx).length;
  const scannedBadge = by("Repos scanned");
  return {
    avg,
    level,
    next,
    distance,
    delta,
    verdict,
    periodsToRung,
    adoption,
    rigor,
    lever,
    atNextRung,
    repos: trajectories.length,
    scanned: scannedBadge && typeof scannedBadge.value === "string" ? scannedBadge.value : null,
  };
}

const WORDS: Record<number, string> = { 2: "Two", 3: "Three", 4: "Four", 5: "Five", 6: "Six", 7: "Seven", 8: "Eight", 9: "Nine" };

/** The sentence under the figure: what the period did, and what that pace means for the rung. */
export function paceSentence(r: NextRungReading, periodTitle: string): string {
  if (r.avg === null) return "";
  const vs = `vs ${periodTitle.toLowerCase()}`;
  if (r.delta === null) return `No earlier reading in this window to compare against.`;
  if (r.verdict === "holding") return `Held within noise ${vs} — the climb has paused.`;
  if (r.verdict === "slipping") return `Down ${Math.abs(r.delta)} ${vs} — the fleet is slipping.`;
  if (!r.next) return `Up ${r.delta} ${vs} — climbing at the top level.`;
  const n = r.periodsToRung ?? 1;
  return `Up ${r.delta} ${vs}. ${n === 1 ? "One more period" : `${WORDS[n] ?? n} more periods`} like this one would reach ${r.next.name}.`;
}

/** The composition sentence: which axis leads, which trails, and so which is the lever. */
export function leverSentence(r: NextRungReading): string | null {
  if (r.adoption === null || r.rigor === null) return null;
  if (!r.lever) return `Adoption and rigor are level at ${r.adoption} — push either.`;
  const lead = r.lever === "rigor" ? "Adoption" : "Rigor";
  const leadV = r.lever === "rigor" ? r.adoption : r.rigor;
  const trailV = r.lever === "rigor" ? r.rigor : r.adoption;
  return `${lead} ${leadV} leads · ${r.lever === "rigor" ? "Rigor" : "Adoption"} ${trailV} trails — ${r.lever} is the lever.`;
}

