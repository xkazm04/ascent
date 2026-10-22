// The register read through ONE archetype lens (card landing-1). Each stored headline was weighted under
// its own repo's lens (engine.ts: overallScoreFor(dimensions, archetype)), so the default board ranks
// numbers from up to three weightings. A lens view re-weights every row with the engine's own
// overallScoreFor and ranks within that one instrument.
//
// Registry: peer-benchmarking `comparability-filters` (a weight-set change is an instrument change; rank
// within one instrument) and measurement-honesty "co-published numbers must reconcile": a row is
// re-weightable only when overallScoreFor over its dimensions, under its OWN lens, reproduces the score
// its report shows. Any other row stays on the as-scored board and is counted, never re-ranked, so the
// page never prints a recompute that contradicts the report a row links to. A mock row is never ranked.
//
// PURE: no hooks, no db, no weights copied here. Imported by the client IndexGallery.

import { isDimensionId, levelForScore, overallScoreFor } from "@/lib/maturity/model";
import { byRank } from "@/lib/register/corpus";
import type { DimensionId, RepoArchetype } from "@/lib/types";

export type RegisterLens = "as-scored" | RepoArchetype;

export const REGISTER_LENS_OPTIONS: { id: RegisterLens; label: string }[] = [
  { id: "as-scored", label: "As scored" },
  { id: "solo", label: "Solo" },
  { id: "team", label: "Team" },
  { id: "org", label: "Org" },
];

/** The slice of a public register card the lens reads. Structural, so a client never imports the db. */
export interface LensCard {
  fullName: string;
  archetype: string;
  dimensions: Partial<Record<DimensionId, number>>;
  overall: number;
  level: string;
  levelName: string;
  scannedAt: string;
  href: string;
  verified: boolean;
  currentRubric: boolean;
  rubricVersion: string | null;
}

export interface LensRow<C extends LensCard> {
  card: C;
  score: number;
  level: string;
  levelName: string;
  rank: number;
  /** Signed places moved vs the as-scored order of the re-weightable rows (positive = moved up). */
  move: number;
  reweightable: boolean;
}

export interface RegisterLensView<C extends LensCard> {
  /** The lens actually applied ("as-scored" whenever a lens is not offered). */
  lens: RegisterLens;
  rows: LensRow<C>[];
  /** Distinct archetype lenses the stored scores on this board were weighted under. */
  lensesOnBoard: number;
  /** Rows kept off a lens ranking (not reproducible, or a mock score). Zero on the as-scored view. */
  withheld: number;
  /** A lens view is a ranking: offered only on a ranked board with at least one re-weightable row. */
  offered: boolean;
}

function presentDims(dims: Partial<Record<DimensionId, number>>): { id: DimensionId; score: number }[] {
  return Object.entries(dims)
    .filter(([id, s]) => isDimensionId(id) && typeof s === "number" && Number.isFinite(s))
    .map(([id, s]) => ({ id: id as DimensionId, score: s as number }));
}

/** True when the engine reproduces the stored headline under the row's own lens, and it is a rating. */
export function isReweightable(card: LensCard): boolean {
  if (!card.verified) return false;
  const dims = presentDims(card.dimensions);
  if (dims.length === 0) return false;
  return overallScoreFor(dims, card.archetype as RepoArchetype) === card.overall;
}

export function registerLens<C extends LensCard>(
  cards: C[],
  requested: RegisterLens,
  { ranked }: { ranked: boolean },
): RegisterLensView<C> {
  const reweightable = cards.map(isReweightable);
  const lensesOnBoard = new Set(cards.map((c) => c.archetype)).size;
  const offered = ranked && reweightable.some(Boolean);
  const lens: RegisterLens = offered ? requested : "as-scored";

  if (lens === "as-scored") {
    const rows = cards.map((card, i) => ({
      card,
      score: card.overall,
      level: card.level,
      levelName: card.levelName,
      rank: i + 1,
      move: 0,
      reweightable: reweightable[i]!,
    }));
    return { lens, rows, lensesOnBoard, withheld: 0, offered };
  }

  const eligible = cards.filter((_, i) => reweightable[i]);
  const before = new Map(eligible.map((c, i) => [c.fullName, i + 1]));
  const rows = eligible
    .map((card) => {
      const score = overallScoreFor(presentDims(card.dimensions), lens);
      const level = levelForScore(score);
      return { card, score, level: level.id as string, levelName: level.name, reweightable: true };
    })
    .sort((a, b) =>
      byRank(
        { overall: a.score, scannedAt: a.card.scannedAt, fullName: a.card.fullName },
        { overall: b.score, scannedAt: b.card.scannedAt, fullName: b.card.fullName },
      ),
    )
    .map((r, i) => ({ ...r, rank: i + 1, move: before.get(r.card.fullName)! - (i + 1) }));
  return { lens, rows, lensesOnBoard, withheld: cards.length - eligible.length, offered };
}
