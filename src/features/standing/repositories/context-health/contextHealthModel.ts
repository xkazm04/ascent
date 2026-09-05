// Context Health — the REAL per-repo model behind the Half-life panel (W4; replaces the P4
// prototype's contextHealthMock synthesis, which is deleted).
//
// Every number here is read off persisted scan output — no synthesis:
//   · presence + per-file freshness/quality/drift  ← Repository.contextHealthJson (latest scan)
//   · change rate                                  ← activity.commitsWeekly (already ingested)
// The decay math (decayPotency / halfLife / guidanceTolerance) lives in the shared derivation
// module (src/lib/analyze/context-health.ts) — the prototype's surviving derive functions — so the
// scan-time potency and this read-time projection can never disagree.
//
// HONESTY RULES the rows encode:
//   · `assessed:false` = the latest scan PREDATES the context-health signal. Rendered as
//     "not assessed by this scan — re-scan", never as fabricated freshness or as "no context".
//   · `potency:null` = the scan ran but the freshness lookup degraded (keyless rate limit, timeout).
//     Quality/drift are still real; only the decay reads "unknown".
//   · staleness counts are APPROXIMATE (weekly-bucket derived) — copy must say ≈, not pretend
//     rev-list precision.
//
// The fleet rollup (fleetContextSummary / ContextFleetSummary) lives in contextHealthSummary.ts for
// the 200-LOC cap and is re-exported below, so this file stays the one import site for the model.

import type { OrgRepoRow } from "@/lib/db/org-rollup";
import type { ContextHealthFile } from "@/lib/types";
import { guidanceTolerance, halfLife } from "@/lib/analyze/context-health";

export { fleetContextSummary } from "./contextHealthSummary";
export type { ContextFleetSummary } from "./contextHealthSummary";

export type ContextBand = "fresh" | "aging" | "stale" | "absent";

export interface RepoContextRow {
  fullName: string;
  name: string;
  /** The repo has at least one scan. */
  scanned: boolean;
  /** The latest scan measured context health (post-W4). */
  assessed: boolean;
  /** At least one guidance file was detected (only meaningful when assessed). */
  present: boolean;
  /** The primary (highest-quality) guidance file's path. */
  primaryPath: string | null;
  ageDays: number | null;
  /** ≈ commits landed since the guidance was last edited (bucket-derived — always approximate). */
  commitsSinceEdit: number | null;
  /** The edit predates the activity window, so commitsSinceEdit undercounts. */
  windowCapped: boolean;
  /** 0..100 remaining potency, or null = freshness unknown (degraded lookup — never fabricated). */
  potency: number | null;
  /** Projected days until potency halves at the current commit rate (Infinity for a quiet repo). */
  halfLifeDays: number | null;
  /** 0..100 guidance quality (the shared guidanceQuality grade). */
  quality: number;
  refsTotal: number;
  deadRefs: string[];
  /** 0..100 composite from the scan. */
  score: number;
  commitsPerWeek: number;
  /** Freshness band; null when the row can't be banded (unassessed, or freshness unknown). */
  band: ContextBand | null;
  verdict: string;
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

function bandFor(present: boolean, potency: number | null): ContextBand | null {
  if (!present) return "absent";
  if (potency == null) return null;
  if (potency >= 66) return "fresh";
  if (potency >= 33) return "aging";
  return "stale";
}

function verdictFor(r: Omit<RepoContextRow, "verdict">): string {
  if (!r.scanned) return "Never scanned";
  if (!r.assessed) return "Not assessed by this scan; re-scan to measure context health";
  if (!r.present) {
    return r.commitsPerWeek >= 4
      ? `No agent context: ${Math.round(r.commitsPerWeek)} commits/wk landing unguided`
      : "No agent context file detected";
  }
  if (r.band === "stale") {
    return `≈${r.commitsSinceEdit}${r.windowCapped ? "+" : ""} commits since last edit: the map no longer matches`;
  }
  if (r.deadRefs.length > 0) {
    return `References ${r.deadRefs.length} file${r.deadRefs.length === 1 ? "" : "s"} that no longer exist`;
  }
  if (r.potency == null) return "Freshness unknown: history lookup degraded; quality and drift still measured";
  if (r.quality < 40) return "Thin guidance: little command / architecture / verify-discipline signal";
  if (r.band === "fresh") return "Current, substantive, and every reference resolves";
  return `Aging: ≈${r.commitsSinceEdit} commits since last edit`;
}

/** Build the Half-life panel's rows from the fleet rollup — pure, no synthesis. */
export function buildContextRows(repos: OrgRepoRow[]): RepoContextRow[] {
  return repos.map((r) => {
    const ch = r.contextHealth;
    const scanned = r.latest != null;
    const assessed = ch != null;
    const commitsPerWeek = Math.round(mean(r.activity?.commitsWeekly ?? []) * 10) / 10;

    // Primary file = highest quality grade, mirroring deriveContextHealth's choice.
    const primary =
      ch?.files.reduce<ContextHealthFile | null>(
        (best, f) => (best == null || f.sectionsScore > best.sectionsScore ? f : best),
        null,
      ) ?? null;

    const present = ch?.present ?? false;
    const potency = ch?.freshness.score ?? null;
    // Half-life is a projection (tolerance ÷ rate) — computable whenever the file's size/quality and
    // a commit rate are known, independent of whether the last-edit date resolved.
    const halfLifeDays =
      present && primary ? halfLife(guidanceTolerance(primary.bytes, primary.sectionsScore), commitsPerWeek) : null;

    const partial: Omit<RepoContextRow, "verdict"> = {
      fullName: r.fullName,
      name: r.name,
      scanned,
      assessed,
      present,
      primaryPath: primary?.path ?? null,
      ageDays: ch?.freshness.ageDays ?? null,
      commitsSinceEdit: ch?.freshness.commitsSinceEdit ?? null,
      windowCapped: ch?.freshness.windowCapped ?? false,
      potency,
      halfLifeDays,
      quality: ch?.quality.score ?? 0,
      refsTotal: ch?.drift.refsTotal ?? 0,
      deadRefs: ch?.drift.deadRefs ?? [],
      score: ch?.score ?? 0,
      commitsPerWeek,
      band: assessed ? bandFor(present, potency) : null,
    };
    return { ...partial, verdict: verdictFor(partial) };
  });
}

/** Most-urgent first: decayed context ahead of missing context (a wrong map misleads an agent
 *  further than no map), unknown-freshness next, absent after, unassessed/unscanned last. */
export function orderByUrgency(rows: RepoContextRow[]): RepoContextRow[] {
  const tier = (r: RepoContextRow) => {
    if (!r.assessed) return 4;
    if (!r.present) return 3;
    if (r.potency == null) return 2;
    return r.potency < 100 ? 0 : 1;
  };
  return [...rows].sort((a, b) => {
    const t = tier(a) - tier(b);
    if (t !== 0) return t;
    if (a.potency != null && b.potency != null && a.potency !== b.potency) return a.potency - b.potency;
    return (b.commitsSinceEdit ?? 0) - (a.commitsSinceEdit ?? 0);
  });
}
