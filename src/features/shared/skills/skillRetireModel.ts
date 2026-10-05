// The retire sweep's pure half: which skills a librarian may be OFFERED for retirement, what each one
// costs, and how the asked-for count reconciles with the count the server actually retired.
//
// Why this is a module and not inline JSX: the preview and the execution must share ONE candidate set.
// A panel that computed "these three" for the eye and then posted a differently-derived list is a
// destructive action whose confirmation describes something other than what happens - which is the
// failure mode a confirm dialog exists to prevent. `SkillRetireSweep.tsx` renders what this returns and
// posts `retirableIds` of the same array; the route then re-derives eligibility from its OWN read, so a
// forged or stale client list cannot archive anything (see src/app/api/org/skills/retire/route.ts).
//
// The SCOPE is not ours to choose. `isPruneCandidate` (src/lib/org/skill-usage.ts) is the only selector:
// `unused` is a discovery problem and `unmeasured` is an absence of data, so neither may ever appear
// here. Re-expressing that predicate locally - "state !== active && state !== new", say - would quietly
// offer four extra skills for deletion the day a sixth state is added.

import type { SkillAdoption, SkillRow } from "@/lib/db";
import { isPruneCandidate, type SkillUsage } from "@/lib/org/skill-usage";

/** Why a listed candidate may not be retired from here. One string per refusal, shown on the row. */
export const REGISTRY_REFUSAL =
  "Mirrored from the registry: the next index pass would restore it. Remove the file in the registry repo instead.";

/** The scope sentence. Names the predicate and the preserved core, so the ask is not a blank "3 skills". */
export const RETIRE_SCOPE_SENTENCE =
  "Only skills this org used and then stopped using are offered. A skill never used, or never measured, is not a prune candidate and is never listed here.";

/** What one call to the retire door answered. `null` at the call site = the request itself failed. */
export interface SweepResult {
  retired?: number;
  restored?: number;
  skipped?: { id: string; reason: string }[];
}

/** One row of the review list: the candidate plus the blast radius the confirmation has to show. */
export interface RetireCandidate {
  id: string;
  name: string;
  origin: SkillRow["origin"];
  /** Repos that recorded this skill as adopted - the dependants, enumerated BEFORE the ask. */
  adoptedRepos: string[];
  lastUsedAt: string | null;
  daysSinceUse: number | null;
  /** The window the dormancy verdict was actually measured against (`SkillUsage.windowDays`). */
  windowDays: number;
  /** False when the row is listed for honesty but is not ours to retire. */
  retirable: boolean;
  /** Why not. Null when `retirable`. */
  reason: string | null;
}

/**
 * The candidate set, in library order. A skill with no usage row is NOT a candidate: absent data is the
 * one thing `isPruneCandidate` refuses to act on, and defaulting a missing row to anything would smuggle
 * that decision back in here.
 */
export function retireCandidates(
  skills: readonly SkillRow[],
  usage: Record<string, SkillUsage>,
  adoption: Record<string, SkillAdoption>,
): RetireCandidate[] {
  const out: RetireCandidate[] = [];
  for (const s of skills) {
    const u = usage[s.id];
    if (!u || !isPruneCandidate(u)) continue;
    const registry = s.origin === "registry";
    out.push({
      id: s.id,
      name: s.name,
      origin: s.origin,
      adoptedRepos: adoption[s.id]?.adoptedRepos ?? [],
      lastUsedAt: u.lastUsedAt,
      daysSinceUse: u.daysSinceUse,
      windowDays: u.windowDays,
      retirable: !registry,
      reason: registry ? REGISTRY_REFUSAL : null,
    });
  }
  return out;
}

/** The ids the sweep may post. Anything the model refused is excluded, not merely greyed out. */
export function retirableIds(candidates: readonly RetireCandidate[]): string[] {
  return candidates.filter((c) => c.retirable).map((c) => c.id);
}

/** "2 repos recorded this" / "1 repo recorded this" / "no repo recorded this". */
export function blastRadiusLabel(adoptedRepos: readonly string[]): string {
  const n = adoptedRepos.length;
  if (n === 0) return "no repo recorded this";
  return `${n} ${n === 1 ? "repo" : "repos"} recorded this`;
}

/** The window the verdict was measured against, said out loud rather than assumed to be 30. */
export function judgedWindowLabel(windowDays: number): string {
  return `judged against ${windowDays} days of silence`;
}

/** "last used 2026-02-01, 44 days ago", or "never used" when there is nothing to date. */
export function lastUseLabel(lastUsedAt: string | null, daysSinceUse: number | null): string {
  if (!lastUsedAt) return "never used";
  const day = lastUsedAt.slice(0, 10);
  if (daysSinceUse === null) return `last used ${day}`;
  return `last used ${day}, ${daysSinceUse} ${daysSinceUse === 1 ? "day" : "days"} ago`;
}

/** The ask, quoting the count it is about to act on. */
export function confirmLine(count: number): string {
  return `Retire ${count} ${count === 1 ? "skill" : "skills"}?`;
}

/**
 * The accounting line. When the server agreed with the preview, the plain count; when it did not, the
 * DIFFERENCE - `retired of asked` plus how many were skipped. Showing the optimistic number after a
 * partial result is how a bulk action teaches people it is lying to them.
 */
export function sweepOutcomeLine(asked: number, retired: number, skipped: number): string {
  if (retired === asked && skipped === 0) {
    return `Retired ${retired} ${retired === 1 ? "skill" : "skills"}.`;
  }
  return `Retired ${retired} of ${asked}. ${skipped} skipped when the server re-checked them.`;
}

/** The undo's own result line, kept beside the outcome line so the two cannot drift apart. */
export function restoreOutcomeLine(asked: number, restored: number, skipped: number): string {
  if (restored === asked && skipped === 0) {
    return `Restored ${restored} ${restored === 1 ? "skill" : "skills"}.`;
  }
  return `Restored ${restored} of ${asked}. ${skipped} skipped when the server re-checked them.`;
}
