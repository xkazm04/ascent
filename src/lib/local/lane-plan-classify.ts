// WHICH OF A PLAN'S ITEMS WAIT FOR A HUMAN, and whether a real diff kept the plan's word
// (spark theater-upgrade, 2026-09-18; WP3). Pure — no db, no git.
//
// THE RULE (operator decision, not to be widened): only an ARCHITECTURE MOVE is major. Per item:
//   • no declared move (after dropping "moves" whose two ends resolve to the SAME module, which move
//     nothing across a boundary) → `minor` / `no-moves`, executes now;
//   • every declared move inside ONE active direction's fence (every module the move names starts
//     with a fence prefix) and that direction has budget left → `minor-under-direction` /
//     `inside-direction-fence`, executes now under that direction;
//   • any other item with moves → `major` / `declared-moves`, parked;
//   • an unreadable plan → EVERY item `major` / `unreadable`, parked (the loud default).
// ONE DIRECTION PER EXECUTION. A lane runs under at most one fence, so when items qualify under
// different directions the one covering the most items wins (ties: the older grant, which is the
// order the caller passes) and an item only another direction covers is parked with the majors. That
// is deliberate: a union of two fences would let one grant's work move inside the other's.
//
// An item the plan gave NO entry declared no move, so it is `minor` — and the post-hoc fence check
// still guards it: an undeclared move in the diff is detected whatever the plan said or omitted.

import { asPrefix, moduleOf } from "@/lib/local/module-partition";
import type { ArchitectureMove, LanePlan, ModulePartition, PlanClass, PlanClassReason, PlanItem } from "@/lib/local/runner-types";

/** An active direction's grant, as the classifier needs it: which fence, under which id. */
export interface DirectionGrant {
  id: string;
  fence: readonly string[];
}

export interface ItemClass {
  recommendationId: string;
  cls: PlanClass;
  reason: PlanClassReason;
  /** The item's moves that cross a boundary (the ones the fence check will hold it to). */
  moves: ArchitectureMove[];
  /** The plan's entry for this item, when it had one. */
  entry: PlanItem | null;
  directionId: string | null;
}

export interface PlanSplit {
  items: ItemClass[];
  /** The ONE direction the executing items run under, or null. */
  direction: DirectionGrant | null;
}

/** A fence as clean, non-root prefixes. A fence of "" or "/" would grant everything — never. */
export function normalizeFence(fence: readonly string[] | null | undefined): string[] {
  return [...new Set((fence ?? []).map(asPrefix).filter((p) => p && !p.split("/").includes("..")))];
}

/** Where a declared endpoint sits: its module, else the path itself as a prefix. */
function resolveEnd(partition: ModulePartition | null, p: string): string {
  return (partition && moduleOf(partition, p)) || asPrefix(p);
}

/** Declared moves minus the ones whose two ends resolve to the same module. */
export function effectiveMoves(moves: readonly ArchitectureMove[], partition: ModulePartition | null): ArchitectureMove[] {
  return moves.filter((m) => !(m.from && m.to && resolveEnd(partition, m.from) === resolveEnd(partition, m.to)));
}

/** Every module every move names starts with one of the fence's prefixes. An empty fence holds nothing. */
export function movesInsideFence(moves: readonly ArchitectureMove[], fence: readonly string[] | null | undefined): boolean {
  const prefixes = normalizeFence(fence);
  if (prefixes.length === 0) return false;
  const inside = (p: string | null) => p == null || prefixes.some((f) => asPrefix(p).startsWith(f));
  return moves.every((m) => inside(m.from) && inside(m.to));
}

/** Classify every batch item, then settle the executing set on ONE direction (see the header). */
export function splitPlan(
  plan: LanePlan | null,
  partition: ModulePartition | null,
  directions: readonly DirectionGrant[],
  batchIds: readonly string[],
): PlanSplit {
  if (!plan) {
    return {
      items: batchIds.map((id) => ({ recommendationId: id, cls: "major", reason: "unreadable", moves: [], entry: null, directionId: null })),
      direction: null,
    };
  }
  const rows = batchIds.map((id) => {
    const entry = plan.items.find((i) => i.recommendationId === id) ?? null;
    const moves = entry ? effectiveMoves(entry.moves, partition) : [];
    const fits = moves.length ? directions.filter((d) => movesInsideFence(moves, d.fence)) : [];
    return { id, entry, moves, fits };
  });
  const tally = directions.map((d) => rows.filter((r) => r.fits.includes(d)).length);
  const best = Math.max(0, ...tally);
  const direction = best > 0 ? directions[tally.indexOf(best)]! : null;
  const items = rows.map((r): ItemClass => {
    if (r.moves.length === 0) return { recommendationId: r.id, cls: "minor", reason: "no-moves", moves: [], entry: r.entry, directionId: null };
    if (direction && r.fits.includes(direction)) {
      return { recommendationId: r.id, cls: "minor-under-direction", reason: "inside-direction-fence", moves: r.moves, entry: r.entry, directionId: direction.id };
    }
    return { recommendationId: r.id, cls: "major", reason: "declared-moves", moves: r.moves, entry: r.entry, directionId: null };
  });
  const used = items.some((i) => i.cls === "minor-under-direction") ? direction : null;
  return { items, direction: used };
}

/** Classify a whole plan (null = unreadable → major): its worst item's class. */
export function classifyPlan(
  plan: LanePlan | null,
  partition: ModulePartition | null,
  activeFences: readonly string[][] = [],
): { cls: PlanClass; reason: PlanClassReason } {
  if (!plan) return { cls: "major", reason: "unreadable" };
  const grants = activeFences.map((fence, i) => ({ id: String(i), fence }));
  const { items } = splitPlan(plan, partition, grants, plan.items.map((i) => i.recommendationId));
  if (items.some((i) => i.cls === "major")) return { cls: "major", reason: "declared-moves" };
  if (items.some((i) => i.cls === "minor-under-direction")) return { cls: "minor-under-direction", reason: "inside-direction-fence" };
  return { cls: "minor", reason: "no-moves" };
}

// ── the post-hoc half: did the REAL diff keep the plan's word? ───────────────────────────────────

/** Does a declared endpoint name the module an actual move names? Either may be the broader one. */
function sameEnd(partition: ModulePartition | null, actual: string | null, declared: string | null, wildcard = false): boolean {
  if (declared == null) return wildcard || actual == null;
  if (actual == null) return false;
  const d = asPrefix(declared);
  if (!d) return false;
  return actual === d || actual.startsWith(d) || d.startsWith(actual) || (partition != null && moduleOf(partition, declared) === actual);
}

/**
 * Is an ACTUAL move covered by what the plan declared — same kind, same modules? Lenient in exactly
 * three documented ways: a declared split/merge also covers the `module-created` of its new module; a
 * declared split with no `to` (or merge with no `from`) is a wildcard on that end; and a declared
 * split/merge covers the `module-removed` of its source. Everything else must match kind for kind.
 */
export function moveCovered(actual: ArchitectureMove, declared: readonly ArchitectureMove[], partition: ModulePartition | null): boolean {
  return declared.some((d) => {
    switch (actual.kind) {
      case "module-created":
        return (d.kind === "module-created" || d.kind === "module-split" || d.kind === "module-merged") && sameEnd(partition, actual.to, d.to);
      case "module-removed":
        return (d.kind === "module-removed" || d.kind === "module-split" || d.kind === "module-merged") && sameEnd(partition, actual.from, d.from);
      case "module-split":
        return d.kind === "module-split" && sameEnd(partition, actual.from, d.from) && sameEnd(partition, actual.to, d.to, true);
      case "module-merged":
        return d.kind === "module-merged" && sameEnd(partition, actual.to, d.to) && sameEnd(partition, actual.from, d.from, true);
      case "cross-module-move":
        return d.kind === "cross-module-move" && sameEnd(partition, actual.from, d.from) && sameEnd(partition, actual.to, d.to);
    }
  });
}

/** The actual moves neither declared nor inside the direction's fence — what gets a lane HELD. */
export function undeclaredMoves(
  actual: readonly ArchitectureMove[],
  declared: readonly ArchitectureMove[],
  directionFence: readonly string[] | null,
  partition: ModulePartition | null,
): ArchitectureMove[] {
  return actual.filter((a) => !moveCovered(a, declared, partition) && !(directionFence && movesInsideFence([a], directionFence)));
}

/** One move as a human reads it. */
export function describeMove(m: ArchitectureMove): string {
  if (m.kind === "module-created") return `module-created ${m.to}`;
  if (m.kind === "module-removed") return `module-removed ${m.from}`;
  return `${m.kind} ${m.from ?? "?"} → ${m.to ?? "?"}`;
}
