// The push-triggered rescan, on the durable ScanJob queue (push-triggered-rescan part 2).
//
// A default-branch push to an autoscanned repo used to run the whole money loop (reserve, scan,
// persist, refund) inline in the webhook's after(), with a process-local per-repo lock and a throttle
// derived from the last PERSISTED scan. Three things were wrong with that: a 300 s kill kept the credit
// and left no row behind, a degraded or failed rescan never closed the throttle window, and two
// instances could each buy inference for the same burst. Now the webhook enqueues ONE rescore job per
// repo per aligned window and drains exactly that job; the worker's push branch
// (scan-queue-worker.ts, PUSH_JOB_REASON) owns the money, and the job row is the durable record.
//
// Lives here, not in the route, because a route file may export only HTTP names.

import { reportHandledError } from "@/lib/api/respond";
import { enqueueScanJob, JOB_PRIORITY } from "@/lib/db/scan-jobs";
import { fleetDeadlineAt } from "@/lib/pool";
import { drainLane, PUSH_JOB_REASON, type DrainSummary } from "@/lib/scan-queue-worker";

/**
 * The per-repo minimum interval between push-triggered scans (G1-05). Default 15 minutes: longer than
 * a median scan (~6 min), and it caps push-driven spend at 4 scans per hour per repo. Override with
 * `PUSH_RESCAN_MIN_INTERVAL_MINUTES`; 0 disables the throttle (one job per delivery).
 */
const DEFAULT_PUSH_RESCAN_MIN_INTERVAL_MINUTES = 15;
export function pushRescanMinIntervalMs(): number {
  const minutes = Number(process.env.PUSH_RESCAN_MIN_INTERVAL_MINUTES);
  const m = Number.isFinite(minutes) && minutes >= 0 ? minutes : DEFAULT_PUSH_RESCAN_MIN_INTERVAL_MINUTES;
  return m * 60_000;
}

/**
 * The idempotency bucket of a push job. One bucket per ALIGNED window (`floor(now / w)`), so every push
 * to a repo inside one window computes the same ScanJob key: the first creates the row, the rest find
 * it. A row that exists, settled or not, buys nothing more, so the window closes on ANY outcome (done,
 * failed, degraded, skipped), not only on a persisted scan. With the throttle off (w = 0) the bucket is
 * the delivery id, so a redelivery still enqueues nothing new; `now` stands in when there is no id.
 */
export function pushRescanBucket(now: number, intervalMs: number, deliveryId?: string): string {
  if (intervalMs <= 0) return `push:${deliveryId ?? now}`;
  return `push:${Math.floor(now / intervalMs)}`;
}

export interface PushRescanInput {
  orgSlug: string;
  fullName: string;
  deliveryId?: string;
  /** When the webhook invocation started; the drain's deadline is measured from it. */
  invokedAt: number;
  /** The route's `maxDuration`, in seconds. */
  maxDurationSec: number;
  now?: number;
}

export type PushRescanResult =
  | { enqueued: false }
  | { enqueued: true; jobId: string; created: boolean; summary: DrainSummary | null };

function reportFailure(what: string, fullName: string, err: unknown): void {
  console.error(`[webhook] push rescan ${what} for ${fullName}`, err instanceof Error ? err.message : err);
  reportHandledError(err, { message: `push rescan ${what}` });
}

/**
 * Enqueue the push's rescore job and drain exactly it.
 *
 * `{ enqueued: false }` means no row exists, so nothing can scan or bill this push: the caller releases
 * the delivery so a redelivery can retry. Once a row exists it IS the durable record, and the delivery
 * is kept even if the drain throws: a killed or failed drain is reaped and retried by the next rescore
 * drain (the 06:00 cron) with any reserved credit carried on the row. A job whose repo another job is
 * already scanning yields at the claim (claimJobById's peer check, which holds across instances) and is
 * requeued behind that lease; the next rescore drain runs it.
 */
export async function enqueueAndDrainPushRescan(input: PushRescanInput): Promise<PushRescanResult> {
  const { orgSlug, fullName, deliveryId } = input;
  const now = input.now ?? Date.now();
  let job: { id: string; created: boolean } | null = null;
  try {
    job = await enqueueScanJob({
      orgSlug,
      repoFullName: fullName,
      lane: "rescore",
      reason: PUSH_JOB_REASON,
      bucket: pushRescanBucket(now, pushRescanMinIntervalMs(), deliveryId),
      priority: JOB_PRIORITY.webhook,
    });
  } catch (err) {
    reportFailure("enqueue failed", fullName, err);
    return { enqueued: false };
  }
  if (!job) {
    reportFailure("enqueue returned no row", fullName, new Error("enqueueScanJob returned null"));
    return { enqueued: false };
  }
  try {
    const summary = await drainLane("rescore", {
      jobs: [{ id: job.id, repo: fullName }],
      concurrency: 1,
      deadlineAt: fleetDeadlineAt(input.invokedAt, input.maxDurationSec),
      orgSlug,
      workerId: `webhook:${deliveryId ?? "no-delivery"}`,
    });
    return { enqueued: true, jobId: job.id, created: job.created, summary };
  } catch (err) {
    reportFailure("drain failed", fullName, err);
    return { enqueued: true, jobId: job.id, created: job.created, summary: null };
  }
}
