// SCAN-CREDIT RESERVATIONS AS LEDGER OBJECTS. A scan's overflow credit is debited on a key that names
// the reservation, and its refund on a key that names the debit:
//
//   debit   scan-job:<jobId>:<attempt>   a queued rescore / import job, per claim attempt
//           scan-hold:<uuid>             an interactive scan's hold (scanCreditGate)
//   refund  refund:<debitKey>
//
// Both land in CreditLedger.externalId, the column that is already UNIQUE, so a refund is idempotent per
// DEBIT (a second refund of one reservation is a P2002 no-op) instead of per invocation, and "does this
// job hold a credit" is a ledger read instead of the best-effort `ScanJob.creditCharged` flag, which a
// lost settle or a kill between reserve and mark can leave saying the wrong thing. The hosted lane's
// `hosted:<id>` / `hosted-refund:<id>` (hosted-credits.ts) is the same rule; this is its scan twin.
//
// The attempt is part of the job key on purpose: a retry of an attempt whose credit was REFUNDED runs
// on a fresh key, so if that retry runs real inference it is charged once - it is not served free on a
// key the ledger already shows as returned.

import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { degradedRead } from "@/lib/org/degraded-read";

const JOB_PREFIX = "scan-job:";
const REFUND_PREFIX = "refund:";

/** The debit key of one claim attempt of one scan job. */
export function scanJobReservationKey(jobId: string, attempt: number): string {
  return `${JOB_PREFIX}${jobId}:${attempt}`;
}

/** The key of the refund that reverses `debitKey`. One per debit, by construction. */
export function refundKeyFor(debitKey: string): string {
  return `${REFUND_PREFIX}${debitKey}`;
}

export interface ScanJobReservation {
  /** The debit key this job still holds (no refund row names it), or null. */
  held: string | null;
  /** True when ANY keyed debit exists for the job. False on a job reserved before keys existed
   *  (an `auto:<uuid>` debit), where `creditCharged` is the only record there is. */
  keyed: boolean;
}

function attemptOf(key: string): number {
  const n = Number(key.slice(key.lastIndexOf(":") + 1));
  return Number.isFinite(n) ? n : 0;
}

/** The job's reservation as the ledger records it. Throws on a failed read; callers decide the fallback. */
export async function readScanJobReservation(orgSlug: string, jobId: string): Promise<ScanJobReservation> {
  if (!isDbConfigured()) return { held: null, keyed: false };
  const debitPrefix = `${JOB_PREFIX}${jobId}:`;
  const rows = (await getPrisma().creditLedger.findMany({
    where: {
      org: { slug: orgSlug.toLowerCase() },
      OR: [{ externalId: { startsWith: debitPrefix } }, { externalId: { startsWith: refundKeyFor(debitPrefix) } }],
    },
    select: { externalId: true },
  })) as { externalId: string | null }[];
  const keys = new Set(rows.map((r) => r.externalId ?? ""));
  const debits = [...keys].filter((k) => k.startsWith(debitPrefix)).sort((a, b) => attemptOf(b) - attemptOf(a));
  return { held: debits.find((k) => !keys.has(refundKeyFor(k))) ?? null, keyed: debits.length > 0 };
}

/** The debit key job `jobId` still holds on the ledger, or null when it holds nothing. */
export async function heldScanReservation(orgSlug: string, jobId: string): Promise<string | null> {
  return (await readScanJobReservation(orgSlug, jobId)).held;
}

/** Whether a claimed scan job already holds a credit, and on which key. */
export interface CarriedReservation {
  carried: boolean;
  /** The held debit key; absent on a pre-key (`auto:`) reservation, whose refund then stays keyless. */
  key?: string;
}

/**
 * The carry decision a claimed rescore / import job makes before reserving. The ledger answers first.
 * `creditCharged` (the best-effort flag) is consulted only where the ledger CANNOT answer: a job with
 * no keyed debit at all (reserved before keys existed) or a ledger read that failed - there the flag
 * is all there is, which is exactly the behaviour before keys.
 */
export async function carriedScanReservation(orgSlug: string, job: { id: string; creditCharged: boolean }): Promise<CarriedReservation> {
  const ledger = await readScanJobReservation(orgSlug, job.id).catch(degradedRead("credit-reservations held read", null));
  if (ledger?.held) return { carried: true, key: ledger.held };
  return { carried: (ledger === null || !ledger.keyed) && job.creditCharged };
}
