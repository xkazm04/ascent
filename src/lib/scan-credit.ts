// Shared per-repo credit reserve → scan → refund core for the three fleet-scan entry points
// (/api/org/import, /api/org/scan, /api/cron/rescan). Each used to reproduce this money loop inline,
// so the refund/dedup invariant lived in triplicate and could silently drift between the funnel, the
// dashboard bulk scan, and the cron — a billing-correctness hazard. These helpers are the exact union
// of the three former inline copies; callers keep their own per-route progress/SSE/counter emission.
//
// See src/lib/db/credits.ts for the underlying ledger accounting and docs/BILLING.md.

import { consumeScanCredit, grantCredits } from "@/lib/db";
import { maybeAlertLowCredits } from "@/lib/scan-alerts";

/** Outcome of a per-repo credit reservation. */
export interface ScanCreditReservation {
  /**
   * True when the balance was exhausted and this repo must be SKIPPED rather than scanned for free.
   * Callers surface the skip in their own way (SSE `repo`/`progress` events vs a counter increment).
   */
  skip: boolean;
  /**
   * True only when an overflow credit was actually DEBITED (within-allowance scans are free). Tracks
   * `charged`, not `ok`, so a within-allowance scan is not later refunded (which would mint a credit).
   * Pass this to `refundScanCredit` to decide whether a refund is owed.
   */
  reserved: boolean;
}

/**
 * RESERVE one prepaid credit for a repo BEFORE scanning. `consumeScanCredit` is an atomic conditional
 * decrement (WHERE scanCredits > 0), so two concurrent batches can't both spend the same credit — the
 * reservation, not a point-in-time balance read, is the real gate. A failed reservation (`skip:true`)
 * means the balance was exhausted (often by another in-flight batch); the caller skips this repo rather
 * than scan it for free. On a successful overflow debit it also fires the proactive low-credit alert.
 *
 * Refund the reservation later (degrade-to-mock / dedup / throw) via `refundScanCredit`.
 */
export async function reserveScanCredit(
  orgSlug: string,
  repoFullName: string,
): Promise<ScanCreditReservation> {
  const res = await consumeScanCredit(orgSlug, { repoFullName }).catch(() => null);
  if (!res || (!res.unlimited && !res.ok)) {
    return { skip: true, reserved: false };
  }
  const reserved = res.charged; // true only on an overflow credit debit (within-allowance is free)
  // Proactive lifecycle push when this debit landed on the low-water mark (or zero).
  if (reserved) await maybeAlertLowCredits(orgSlug, res.balance);
  return { skip: false, reserved };
}

/**
 * Refund a reservation when nothing billable was produced (degrade-to-mock / dedup / throw). No-op
 * unless an overflow credit was actually charged (`reserved`). Best-effort: a failed grant is swallowed.
 */
export async function refundScanCredit(orgSlug: string, reserved: boolean): Promise<void> {
  if (reserved) await grantCredits(orgSlug, 1, { reason: "refund", actor: "system" }).catch(() => {});
}

/**
 * The shared refund policy: refund the reservation when the scan degraded to mock (no real inference)
 * OR the commit was unchanged since the last scan (`deduped` — no new scored row). "A dedup run is free."
 */
export function shouldRefundScan(
  report: { engine: { provider: string } },
  persisted: { deduped: boolean } | null | undefined,
): boolean {
  return report.engine.provider === "mock" || Boolean(persisted?.deduped);
}

/**
 * The shared partial-write warning. Persistence is atomic (a true failure throws + rolls back), but a
 * returned result with audit/contributor failures still warrants a log so monitoring can see the drift.
 */
export function logPartialWrites(
  tag: string,
  repo: string,
  persisted: { scanId: string; failures: { audit: boolean; contributors: number } } | null | undefined,
): void {
  if (persisted && (persisted.failures.audit || persisted.failures.contributors > 0)) {
    console.warn(`[${tag}] persisted with partial write failures`, {
      repo,
      scanId: persisted.scanId,
      failures: persisted.failures,
    });
  }
}
