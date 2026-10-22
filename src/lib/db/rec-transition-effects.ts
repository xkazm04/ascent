// Run the consequences of a recommendation status change - the db side of rec-transitions.ts.
//
// Every writer that moves a status calls this AFTER its write commits: the PATCH route, the rescan
// carry-forward in scans-persist (rows a rescan resolved), and the loop's craft-rung close in
// lane-outcomes. The writers it runs are the existing ones, unchanged:
//   close-memory        recordRecommendationClosedMemory (or recordRecommendationClose, which
//                       resolves org + repo from the id when the caller does not hold them)
//   standing-dismissal  recordRecommendationDismissal
//   reopen-decision     clearRecommendationDismissal
//
// NEVER THROWS. A consequence is decoration on a write that already succeeded; one failing writer is
// logged and named in `failed`, and the next effect still runs. Each writer is idempotent on its own
// (memory dedups on content, decisions upsert), so a retried caller writes one row, not two.

import { recordRecommendationClose, recordRecommendationClosedMemory } from "@/lib/memory/scan-feed";
import { clearRecommendationDismissal, recordRecommendationDismissal } from "@/lib/db/org-decisions";
import { planRecTransition, type RecTransition, type RecTransitionEffect } from "@/lib/report/rec-transitions";

export interface RecTransitionInput extends RecTransition {
  title: string;
  dimension: string;
}

export interface RecTransitionScope {
  recommendationId: string;
  /** The timeline actor (a GitHub login, "autopilot", or null for the system). */
  actor?: string | null;
  /** The owning org + repo, when the caller already holds them: skips the id -> repo read. */
  orgId?: string;
  repoFullName?: string;
  at?: Date;
}

export interface RecTransitionOutcome {
  applied: RecTransitionEffect[];
  failed: RecTransitionEffect[];
}

async function runEffect(effect: RecTransitionEffect, t: RecTransitionInput, scope: RecTransitionScope): Promise<void> {
  const rec = { title: t.title, dimension: t.dimension };
  const actor = scope.actor ?? null;
  switch (effect) {
    case "close-memory":
      if (scope.orgId && scope.repoFullName) {
        await recordRecommendationClosedMemory(scope.orgId, scope.repoFullName, rec, scope.at);
      } else {
        await recordRecommendationClose(scope.recommendationId, rec, scope.at);
      }
      return;
    case "standing-dismissal":
      await recordRecommendationDismissal(scope.recommendationId, { ...rec, reason: t.reason ?? null }, actor);
      return;
    case "reopen-decision":
      await clearRecommendationDismissal(scope.recommendationId, rec, actor);
      return;
  }
}

export async function applyRecTransitionEffects(
  transition: RecTransitionInput,
  scope: RecTransitionScope,
): Promise<RecTransitionOutcome> {
  const out: RecTransitionOutcome = { applied: [], failed: [] };
  let effects: RecTransitionEffect[];
  try {
    effects = planRecTransition(transition);
  } catch {
    return out;
  }
  for (const effect of effects) {
    try {
      await runEffect(effect, transition, scope);
      out.applied.push(effect);
    } catch (err) {
      out.failed.push(effect);
      console.warn(
        `[rec-transition-effects] ${effect} failed for ${scope.recommendationId} (status write unaffected)`,
        err instanceof Error ? err.message : err,
      );
    }
  }
  return out;
}
