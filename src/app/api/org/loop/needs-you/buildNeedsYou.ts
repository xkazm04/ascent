// The needs-you ASSEMBLY — server-side, beside its route, because it shares the pulse's rule for
// "a pause that needs the operator" (`needsOperator`, src/lib/db/loop-pulse-fold.ts) and a client module
// may not import the db layer. One rule, so the theater's NEEDS YOU count and the notifier can never
// disagree about a paused repo: `dry-backoff` lifts on its own timer and counts in neither.
//
// What counts: a plan in the approval inbox (`pending`), a repo the org's LIVE continuous drive paused on
// a breaker only a person clears, and a runner-wide pause. `runner` says whether such a drive exists.

import { needsOperator } from "@/lib/db/loop-pulse-fold";
import { isDriveLive, type DriveStatus } from "@/lib/local/drive-types";
import type { LoopPlanRecord, RepoPauseReason } from "@/lib/local/runner-types";
import { planTitle, type NeedsYouResponse } from "@/lib/org/runner-needs-you";

export function buildNeedsYou(plans: readonly LoopPlanRecord[], drives: readonly DriveStatus[]): NeedsYouResponse {
  const runner = drives.find((d) => d.mode === "continuous" && isDriveLive(d.phase)) ?? null;
  const pausedReason = runner?.phase === "paused" ? (runner.pausedReason ?? null) : null;
  return {
    runner: runner !== null,
    plans: plans
      .filter((p) => p.status === "pending")
      .map((p) => ({ id: p.id, repo: p.repo, title: planTitle(p), createdAt: p.createdAt })),
    pausedRepos: (runner?.repoState ?? [])
      .filter(needsOperator)
      .map((r) => ({ repo: r.repo, reason: r.paused as RepoPauseReason, note: r.note ?? null })),
    runnerPaused: pausedReason ? { reason: pausedReason, until: runner?.pausedUntil ?? null } : null,
  };
}
