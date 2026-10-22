// What a recommendation status change MEANS - the one table every writer asks.
//
// A status move is a row update; some moves also carry a consequence outside the row:
//   close-memory        a gap actually closed (`done`) is org intelligence, so it is written to
//                       Shared Org Memory as an episodic "Recommendation closed on <repo>" row.
//   standing-dismissal  "we are not doing this, because..." becomes a standing decision the next
//                       scan's prompt reads, so the same gap is not re-raised. A dismissal WITHOUT a
//                       reason records nothing: silence must never become permanent suppression.
//   reopen-decision     leaving `dismissed` lifts that standing decision, so an un-dismissed gap
//                       stops being suppressed. The writer is a no-op when no decision exists.
//
// This used to live inline in PATCH /api/recommendations/:id, so the rescan witness (the close the
// claim module calls the only real one) and the loop's craft-rung close fired none of it. Pure: the
// db side runs the plan (src/lib/db/rec-transition-effects.ts), post-commit and never-throwing.

import type { RecStatus } from "@/lib/types";

export type RecTransitionEffect = "close-memory" | "standing-dismissal" | "reopen-decision";

export interface RecTransition {
  /** The status before the write. `null` = unknown (the PATCH route does not read it): the plan
   *  then lifts any standing dismissal defensively, which is what the route always did. */
  from: RecStatus | null;
  /** The persisted post-state. */
  to: RecStatus;
  /** The dismissal reason (the PATCH `note`). Blank counts as absent. */
  reason?: string | null;
}

/** Statuses that count as "closed". `dismissed` is not one: "we decided not to" is a different fact
 *  from "this gap was closed" (mirrors isClosedRecStatus in the memory feed). */
const CLOSED: ReadonlySet<RecStatus> = new Set<RecStatus>(["done"]);

export function planRecTransition(t: RecTransition): RecTransitionEffect[] {
  const reason = t.reason?.trim() ?? "";
  if (t.to === "dismissed") {
    // A re-dismissal with a new reason re-records it (the decision write upserts); without a reason
    // a dismissal is silence, and silence suppresses nothing.
    return reason ? ["standing-dismissal"] : [];
  }
  // Same status in, same status out: nothing happened, so nothing follows.
  if (t.from === t.to) return [];
  const effects: RecTransitionEffect[] = [];
  if (CLOSED.has(t.to)) effects.push("close-memory");
  // Any non-dismissed post-state lifts the standing dismissal when the prior state was dismissed, or
  // unknown. A move that never passed through dismissed has no decision to lift.
  if (t.from === null || t.from === "dismissed") effects.push("reopen-decision");
  return effects;
}
