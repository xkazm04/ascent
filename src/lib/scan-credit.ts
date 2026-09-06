// Shared per-repo credit reserve → scan → refund core for the three fleet-scan entry points
// (/api/org/import, /api/org/scan, /api/cron/rescan). Each used to reproduce this money loop inline,
// so the refund/dedup invariant lived in triplicate and could silently drift between the funnel, the
// dashboard bulk scan, and the cron — a billing-correctness hazard. These helpers are the exact union
// of the three former inline copies; callers keep their own per-route progress/SSE/counter emission.
//
// See src/lib/db/credits.ts for the underlying ledger accounting and docs/features/billing/billing.md.

import { consumeScanCredit, CREDIT_REASON, grantCredits } from "@/lib/db";
import { maybeAlertLowCredits } from "@/lib/scan-alerts";

/**
 * WHO and WHAT a credit movement is for — stamped onto the CreditLedger row so spend is joinable.
 *
 * WHICH ROWS CAN CARRY WHICH, and why it is not uniform. `repoFullName` is always available at the
 * debit (the reserve happens per-repo, by name) and is threaded to the matching refund, so a debit and
 * its reversal can always be netted per repo. `actor` is whatever the call site honestly knows: the
 * viewer login on an interactive scan, the queue `reason` on a drained job, "webhook" / "system" where
 * no human is behind it — never a guess.
 *
 * `scanId` is the one that is usually ABSENT, and deliberately so. Every scan path here reserves
 * BEFORE inference runs, so at debit time no Scan row exists to point at; and `persistScanReport` does
 * not return the row's id, so it is unknown at refund time too. The ledger is append-only — a row is
 * written once — so back-filling the id onto the debit afterwards is not an option we take. It stays
 * optional for the callers that genuinely know it up front (a re-scan of a known row), where it also
 * upgrades `consumeScanCredit`'s idempotency key from a per-invocation `auto:<uuid>` to the natural
 * key `scan:<scanId>`, which is what makes a redelivered debit collapse instead of double-charging.
 */
export interface ScanSpendAttribution {
  /** GitHub login of the viewer who caused the spend, or the honest non-human word for the path. */
  actor?: string;
  /** The Scan row this movement pays for, when it is known BEFORE the debit. Usually undefined. */
  scanId?: string;
}

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
  /**
   * The org's prepaid balance as the reservation left it — post-debit on the `reserved` path, the
   * current balance otherwise; `null` only when the underlying consume threw. Present so a caller that
   * must REPORT the balance (a route surfacing `x-ascent-credits-remaining`, or a 402 body that has to
   * name the balance a concurrent scan just moved) does not have to re-read it and get a second,
   * different answer. Batch callers ignore it, exactly as before.
   */
  balance: number | null;
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
  opts: ScanSpendAttribution = {},
): Promise<ScanCreditReservation> {
  const res = await consumeScanCredit(orgSlug, { repoFullName, actor: opts.actor, scanId: opts.scanId }).catch(
    () => null,
  );
  if (!res || (!res.unlimited && !res.ok)) {
    return { skip: true, reserved: false, balance: res?.balance ?? null };
  }
  const reserved = res.charged; // true only on an overflow credit debit (within-allowance is free)
  // Proactive lifecycle push when this debit CROSSED the low-water mark (or depletion). The debit
  // site knows its own size: consumeScanCredit charges exactly one credit on the `charged` path, so
  // the pre-debit balance is balance + 1 — stated here, next to the debit, not assumed downstream.
  if (reserved) await maybeAlertLowCredits(orgSlug, res.balance + 1, res.balance);
  return { skip: false, reserved, balance: res.balance };
}

/**
 * Refund a reservation when nothing billable was produced (degrade-to-mock / dedup / throw). No-op
 * unless an overflow credit was actually charged (`reserved`). Best-effort: a failed grant is swallowed.
 *
 * Returns the POST-refund balance, or `null` when nothing was refunded / the grant failed — so a route
 * that already reported `x-ascent-credits-remaining` can correct it without a second read. Every
 * existing caller ignores the value (a widened return is invisible to `await refundScanCredit(...)`).
 */
export async function refundScanCredit(
  orgSlug: string,
  reserved: boolean,
  opts: ScanSpendAttribution & { repoFullName?: string } = {},
): Promise<number | null> {
  if (!reserved) return null;
  return await grantCredits(orgSlug, 1, {
    reason: CREDIT_REASON.REFUND,
    // "system" stays the floor, not the answer: it is what a refund fired by a path with no human or
    // job behind it honestly is. A caller that knows better (the viewer who ran the scan, the queue
    // reason that scheduled it) passes its own word and the reversal names the same actor as the debit.
    actor: opts.actor ?? "system",
    repoFullName: opts.repoFullName,
    scanId: opts.scanId,
  }).catch(() => null);
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

// NOTE (scan-persistence-history 07-16 #3): the former `logPartialWrites` helper is GONE. It watched
// PersistResult's `failures` field, which persistScanReport hardcoded to "no failure" at every return
// site (persistence is atomic — a partial failure THROWS and rolls the scan back), so the warning was
// provably dead. The field has been removed from PersistResult; genuine best-effort post-commit steps
// (tech-group sync) log their own failures inline in scans-persist.ts.
