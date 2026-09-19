// Derived facts for the Dimensions explorer — pure, server-safe, shared by every rendering of the
// nine-dimension breakdown. Each fact answers a question the raw DimensionResult leaves the reader
// to compute in their head: which level band a score sits in and how far the next rung is, how many
// overall points a dimension still has "in reach" (its weighted headroom — the lever), how far the
// model's judgment sat from the detectors, and the one-line takeaway across all nine.

import type { Axis, DimensionId, DimensionResult, MaturityLevel } from "@/lib/types";
import { DIMENSION_BY_ID, levelForScore, nextLevel } from "@/lib/maturity/model";
import { scoreProvenance, type ScoreProvenance } from "@/lib/scoring/provenance";
import type { ScoreIntegrity } from "@/lib/types";
import { DIMENSION_SHORT } from "@/lib/ui";

export interface DimFacts {
  d: DimensionResult;
  id: DimensionId;
  short: string;
  axis: Axis;
  level: MaturityLevel;
  /** The next level band, or null at the summit. */
  next: MaturityLevel | null;
  /** Points to the next band's floor (null at L5). */
  toNext: number | null;
  /** Overall points this dimension currently contributes (weight × score). */
  contributes: number;
  /** Overall points still in reach if this dimension went to 100 (weight × (100 − score)). */
  headroom: number;
  /** Since-last-scan delta, null when there is no previous scan or it lacked this dimension. */
  delta: number | null;
  /** Model judgment minus detector signal (positive = the model argued above the detectors). */
  divergence: number;
  provenance: ScoreProvenance;
}

export function dimFacts(
  d: DimensionResult,
  prevScore: number | undefined,
  integrity?: ScoreIntegrity | null,
): DimFacts {
  const level = levelForScore(d.score);
  const next = nextLevel(level.id);
  return {
    d,
    id: d.id,
    short: DIMENSION_SHORT[d.id] ?? d.id,
    axis: DIMENSION_BY_ID[d.id]?.axis ?? "rigor",
    level,
    next,
    toNext: next ? Math.max(0, next.band[0] - d.score) : null,
    contributes: d.weight * d.score,
    headroom: d.weight * (100 - d.score),
    delta: prevScore !== undefined ? d.score - prevScore : null,
    divergence: d.llmScore - d.signalScore,
    provenance: scoreProvenance(d, integrity),
  };
}

export interface ExplorerSummary {
  leader: DimFacts;
  trailer: DimFacts;
  /** The dimension with the most overall points in reach — the biggest lever. */
  lever: DimFacts;
  /** How many dimensions sit at Integrated (L4) or above. */
  atL4: number;
  /** One plain-language line — the takeaway a reader should leave with. */
  line: string;
}

export function explorerSummary(facts: DimFacts[]): ExplorerSummary | null {
  if (facts.length === 0) return null;
  const byScore = [...facts].sort((a, b) => b.d.score - a.d.score);
  const leader = byScore[0]!;
  const trailer = byScore[byScore.length - 1]!;
  const lever = [...facts].sort((a, b) => b.headroom - a.headroom)[0]!;
  const atL4 = facts.filter((f) => f.d.score >= 65).length;
  const gap = leader.d.score - trailer.d.score;
  const parts = [`${leader.short} leads at ${leader.d.score}`];
  if (facts.length > 1) parts.push(`${trailer.short} trails ${gap} pts`);
  parts.push(`biggest lever: ${lever.short} (+${lever.headroom.toFixed(1)} overall pts in reach)`);
  return { leader, trailer, lever, atL4, line: parts.join(" · ") };
}

/** Plain-language provenance caption — which mechanism produced this dimension's number. */
export function provenanceLabel(p: ScoreProvenance): string {
  if (p.kind === "signal-only") return "detector battery, verbatim";
  if (p.kind === "claim-scored") return `signal + ${p.claimPoints} verified-citation pts`;
  return p.widened ? "blended · band widened" : "blended";
}
