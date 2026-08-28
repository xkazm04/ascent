// THE BOOT SWEEP — the one thing a fresh process knows that no request handler does: nothing this
// process started is in flight, so every `running` loop run and every `running` drive in the database
// belongs to a process that is gone.
//
// Before this existed the reconcile ran only on the first `GET /api/org/loop` and inside
// `startLoopRun`, so a crashed run read as `running` until somebody opened the tab — and the backlog
// rows its lanes had claimed stayed `in_progress` for exactly as long (the zombie-claim failure that
// made drive #2 find "no open follow-ups" on a fleet with 350 points of debt). A digest, a direct DB
// reader, or simply nobody opening the tab all saw a lie.
//
// SANCTIONED PLACE: `src/instrumentation.ts`'s `register()`, Next's startup hook — the same door the
// embedded PGlite boots from, and it runs before the first request. Called with no `isLive` predicate
// on purpose: that default ("nothing is live") is WRONG for every request path and exactly right here.
//
// SELF-HOSTED ONLY, and that guard is load-bearing rather than cosmetic. The loop and the drive exist
// only on a self-hosted deployment (they read the server's filesystem and spawn processes), so on
// managed cloud there is nothing to reconcile — and a managed deployment can run many instances, where
// "this process started nothing" would be a claim about one instance applied to every other one's
// live work.

import { selfHosted } from "@/lib/env";
import { isDbConfigured } from "@/lib/db/client";
import { markStaleRunsStopped } from "@/lib/db/loop-runs";
import { markStaleDrivesInterrupted } from "@/lib/db/drives";

export interface BootSweepResult {
  /** Skipped without looking: not self-hosted, or no database configured. */
  skipped: boolean;
  runs: number;
  drives: number;
}

const DONE_KEY = "__ascentBootSweepDone" as const;

/**
 * Reconcile the work a dead process left behind. Runs first, then drives: `markStaleRunsStopped` is
 * what releases the backlog claims of a run's in-flight lanes, and a drive's own row owns no claims —
 * so sweeping runs first means a drive is never marked interrupted while its last run still looks
 * alive.
 *
 * Idempotent per process (a second call is a no-op) so a dev-server hot reload that re-enters
 * `register()` cannot sweep twice.
 */
export async function sweepInterruptedWork(): Promise<BootSweepResult> {
  const g = globalThis as unknown as Record<string, unknown>;
  if (g[DONE_KEY]) return { skipped: true, runs: 0, drives: 0 };
  g[DONE_KEY] = true;

  if (!selfHosted() || !isDbConfigured()) return { skipped: true, runs: 0, drives: 0 };
  const runs = await markStaleRunsStopped().catch(() => 0);
  const drives = await markStaleDrivesInterrupted().catch(() => 0);
  return { skipped: false, runs, drives };
}

/** The line the boot sweep prints when it actually reconciled something. Silent otherwise — a clean
 *  boot has nothing to say, and a log line every start would train the operator to ignore it. */
export function bootSweepLine(r: BootSweepResult): string | null {
  if (r.skipped || (r.runs === 0 && r.drives === 0)) return null;
  const parts: string[] = [];
  if (r.runs > 0) parts.push(`${r.runs} loop ${r.runs === 1 ? "run" : "runs"} stopped`);
  if (r.drives > 0) parts.push(`${r.drives} ${r.drives === 1 ? "drive" : "drives"} marked interrupted`);
  return `[loop] boot sweep: ${parts.join(", ")} — a previous process died while they were in flight.`;
}
